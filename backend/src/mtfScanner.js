/**
 * MTF Scanner - 多时间框架扫描器
 * 整合多个时间框架的分析结果，生成交易信号
 */

const { getMultiTimeframeAnalysis } = require('./multiTimeframe');
const { detectLiquiditySweeps } = require('./liquiditySweep');
const { analyzeOrderBlocks, analyzeDisplacement } = require('./strategy');
const logger = require('./utils/logger');

// 信号状态枚举
const SignalStatus = {
  ACTIVE: 'active',
  PENDING: 'pending',
  TRIGGERED: 'triggered',
  EXPIRED: 'expired',
  INVALIDATED: 'invalidated'
};

// 信号类型
const SignalType = {
  LONG: 'long',
  SHORT: 'short'
};

// 信号质量等级
const SignalQuality = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

class MTFScanner {
  constructor() {
    this.signals = new Map();
    this.signalHistory = [];
    this.maxHistorySize = 1000;
    this.scanInterval = null;
    this.isScanning = false;
    this.scanCount = 0;
    
    // 配置参数
    this.config = {
      minTimeframesAligned: 2,      // 最小对齐时间框架数
      minQualityScore: 60,          // 最低质量分数
      maxSignalAge: 4 * 60 * 60 * 1000, // 信号最大存活时间（4小时）
      scanInterval: 30000,          // 扫描间隔（30秒）
      confidenceThreshold: 0.6      // 置信度阈值
    };
  }

  /**
   * 启动扫描器
   */
  start() {
    if (this.scanInterval) {
      logger.warn('MTF Scanner already running');
      return;
    }

    logger.info('Starting MTF Scanner...');
    this.isScanning = true;
    
    // 立即执行一次扫描
    this.scan();
    
    // 定时扫描
    this.scanInterval = setInterval(() => {
      this.scan();
    }, this.config.scanInterval);

    logger.info('MTF Scanner started successfully');
  }

  /**
   * 停止扫描器
   */
  stop() {
    if (!this.scanInterval) {
      logger.warn('MTF Scanner not running');
      return;
    }

    clearInterval(this.scanInterval);
    this.scanInterval = null;
    this.isScanning = false;
    logger.info('MTF Scanner stopped');
  }

  /**
   * 执行扫描
   */
  async scan() {
    try {
      this.scanCount++;
      const scanStartTime = Date.now();
      
      logger.info(`Starting scan #${this.scanCount}...`);

      // 获取多时间框架分析
      const mtfAnalysis = await getMultiTimeframeAnalysis();
      
      // 检测流动性清扫
      const liquiditySweeps = await detectLiquiditySweeps();
      
      // 生成信号
      const newSignals = this.generateSignals(mtfAnalysis, liquiditySweeps);
      
      // 更新信号状态
      this.updateSignalStatus();
      
      // 清理过期信号
      this.cleanExpiredSignals();

      const scanDuration = Date.now() - scanStartTime;
      logger.info(`Scan #${this.scanCount} completed in ${scanDuration}ms, generated ${newSignals.length} new signals`);

      return {
        scanId: this.scanCount,
        duration: scanDuration,
        newSignals,
        totalActiveSignals: this.getActiveSignals().length
      };
    } catch (error) {
      logger.error('Scan failed:', error);
      return { error: error.message };
    }
  }

  /**
   * 生成交易信号
   */
  generateSignals(mtfAnalysis, liquiditySweeps) {
    const newSignals = [];
    const symbols = Object.keys(mtfAnalysis);

    for (const symbol of symbols) {
      try {
        const analysis = mtfAnalysis[symbol];
        
        // 检查多时间框架对齐
        const alignment = this.checkTimeframeAlignment(analysis);
        
        // 检查流动性清扫
        const sweep = liquiditySweeps.find(s => s.symbol === symbol);
        
        // 生成信号
        if (alignment.isAligned && alignment.strength >= this.config.minQualityScore) {
          const signal = this.createSignal(symbol, analysis, alignment, sweep);
          
          if (signal && this.validateSignal(signal)) {
            // 检查是否已存在相同信号
            const existingSignal = this.findExistingSignal(symbol, signal.type);
            
            if (!existingSignal) {
              this.signals.set(signal.id, signal);
              newSignals.push(signal);
              this.addToHistory(signal);
              
              logger.info(`New signal generated: ${signal.id}`, {
                symbol: signal.symbol,
                type: signal.type,
                quality: signal.quality,
                status: signal.status
              });
            }
          }
        }
      } catch (error) {
        logger.error(`Failed to generate signal for ${symbol}:`, error);
      }
    }

    return newSignals;
  }

  /**
   * 创建信号对象
   */
  createSignal(symbol, analysis, alignment, sweep) {
    const now = Date.now();
    const id = `sig_${symbol}_${now}`;
    
    // 确定信号类型（做多/做空）
    const signalType = alignment.direction === 'bullish' ? SignalType.LONG : SignalType.SHORT;
    
    // 计算入场价格
    const entryPrice = this.calculateEntryPrice(analysis, signalType, sweep);
    
    // 计算止损价格
    const stopLoss = this.calculateStopLoss(analysis, signalType, sweep);
    
    // 计算止盈价格
    const takeProfits = this.calculateTakeProfits(entryPrice, stopLoss, signalType);
    
    // 计算风险回报比
    const riskReward = this.calculateRiskReward(entryPrice, stopLoss, takeProfits.tp1);
    
    // 确定信号质量
    const quality = this.determineSignalQuality(alignment, sweep, riskReward);
    
    // 计算置信度
    const confidence = this.calculateConfidence(alignment, sweep);
    
    // 获取时间框架分析
    const timeframes = this.extractTimeframeAnalysis(analysis);

    // 创建信号对象 - 确保包含 status 字段
    const signal = {
      id,
      symbol,
      type: signalType,
      status: SignalStatus.ACTIVE,  // 关键：确保 status 字段存在
      quality,
      confidence,
      
      // 价格信息
      entryPrice,
      stopLoss,
      takeProfits,
      riskReward,
      
      // 时间信息
      timestamp: now,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.config.maxSignalAge).toISOString(),
      
      // 分析数据
      timeframeAlignment: alignment,
      liquiditySweep: sweep || null,
      timeframes,
      
      // 元数据
      metadata: {
        scanCount: this.scanCount,
        timeframeCount: Object.keys(analysis).length,
        alignedTimeframes: alignment.alignedTimeframes || []
      },
      
      // 更新历史
      updates: [{
        timestamp: now,
        status: SignalStatus.ACTIVE,
        message: 'Signal created'
      }]
    };

    return signal;
  }

  /**
   * 验证信号有效性
   */
  validateSignal(signal) {
    // 检查必需字段
    if (!signal.id || !signal.symbol || !signal.type) {
      logger.warn('Signal missing required fields');
      return false;
    }

    // 检查价格有效性
    if (!signal.entryPrice || signal.entryPrice <= 0) {
      logger.warn(`Invalid entry price for ${signal.symbol}`);
      return false;
    }

    if (!signal.stopLoss || signal.stopLoss <= 0) {
      logger.warn(`Invalid stop loss for ${signal.symbol}`);
      return false;
    }

    // 检查风险回报比
    if (!signal.riskReward || signal.riskReward < 1) {
      logger.warn(`Risk reward ratio too low for ${signal.symbol}: ${signal.riskReward}`);
      return false;
    }

    // 检查置信度
    if (signal.confidence < this.config.confidenceThreshold) {
      logger.warn(`Confidence too low for ${signal.symbol}: ${signal.confidence}`);
      return false;
    }

    // 确保 status 字段存在
    if (!signal.status) {
      signal.status = SignalStatus.ACTIVE;
    }

    return true;
  }

  /**
   * 检查时间框架对齐
   */
  checkTimeframeAlignment(analysis) {
    const timeframes = Object.keys(analysis);
    let bullishCount = 0;
    let bearishCount = 0;
    let totalStrength = 0;
    const alignedTimeframes = [];

    for (const tf of timeframes) {
      const tfAnalysis = analysis[tf];
      
      if (tfAnalysis.trend === 'bullish') {
        bullishCount++;
        totalStrength += tfAnalysis.strength || 50;
        alignedTimeframes.push({ timeframe: tf, direction: 'bullish', strength: tfAnalysis.strength });
      } else if (tfAnalysis.trend === 'bearish') {
        bearishCount++;
        totalStrength += tfAnalysis.strength || 50;
        alignedTimeframes.push({ timeframe: tf, direction: 'bearish', strength: tfAnalysis.strength });
      }
    }

    const isAligned = bullishCount >= this.config.minTimeframesAligned || 
                      bearishCount >= this.config.minTimeframesAligned;
    
    const direction = bullishCount > bearishCount ? 'bullish' : 'bearish';
    const strength = totalStrength / timeframes.length;

    return {
      isAligned,
      direction,
      strength: Math.round(strength),
      bullishCount,
      bearishCount,
      totalTimeframes: timeframes.length,
      alignedTimeframes
    };
  }

  /**
   * 计算入场价格
   */
  calculateEntryPrice(analysis, signalType, sweep) {
    // 获取最新价格
    const latestTf = Object.keys(analysis)[0];
    const latestPrice = analysis[latestTf]?.currentPrice || analysis[latestTf]?.close;
    
    if (!latestPrice) {
      logger.warn('Could not determine current price');
      return 0;
    }

    // 如果有流动性清扫，使用清扫价格
    if (sweep && sweep.price) {
      return parseFloat(sweep.price.toFixed(4));
    }

    // 根据订单块计算入场价格
    const obAnalysis = analyzeOrderBlocks(analysis[latestTf]?.candles || []);
    if (obAnalysis.orderBlocks.length > 0) {
      const ob = obAnalysis.orderBlocks[0];
      if (signalType === SignalType.LONG && ob.type === 'bullish') {
        return parseFloat(ob.bottom.toFixed(4));
      } else if (signalType === SignalType.SHORT && ob.type === 'bearish') {
        return parseFloat(ob.top.toFixed(4));
      }
    }

    return parseFloat(latestPrice.toFixed(4));
  }

  /**
   * 计算止损价格
   */
  calculateStopLoss(analysis, signalType, sweep) {
    const latestTf = Object.keys(analysis)[0];
    const latestPrice = analysis[latestTf]?.currentPrice || analysis[latestTf]?.close;
    
    // 如果有流动性清扫，使用清扫的止损
    if (sweep && sweep.stopLoss) {
      return parseFloat(sweep.stopLoss.toFixed(4));
    }

    // 根据订单块设置止损
    const obAnalysis = analyzeOrderBlocks(analysis[latestTf]?.candles || []);
    if (obAnalysis.orderBlocks.length > 0) {
      const ob = obAnalysis.orderBlocks[0];
      if (signalType === SignalType.LONG) {
        return parseFloat((ob.bottom * 0.995).toFixed(4)); // 订单块下方0.5%
      } else {
        return parseFloat((ob.top * 1.005).toFixed(4)); // 订单块上方0.5%
      }
    }

    // 默认止损：做多在入场价下方1%，做空在入场价上方1%
    const stopDistance = latestPrice * 0.01;
    if (signalType === SignalType.LONG) {
      return parseFloat((latestPrice - stopDistance).toFixed(4));
    } else {
      return parseFloat((latestPrice + stopDistance).toFixed(4));
    }
  }

  /**
   * 计算止盈价格
   */
  calculateTakeProfits(entryPrice, stopLoss, signalType) {
    const risk = Math.abs(entryPrice - stopLoss);
    
    if (signalType === SignalType.LONG) {
      return {
        tp1: parseFloat((entryPrice + risk * 1.5).toFixed(4)),
        tp2: parseFloat((entryPrice + risk * 2.5).toFixed(4)),
        tp3: parseFloat((entryPrice + risk * 4).toFixed(4))
      };
    } else {
      return {
        tp1: parseFloat((entryPrice - risk * 1.5).toFixed(4)),
        tp2: parseFloat((entryPrice - risk * 2.5).toFixed(4)),
        tp3: parseFloat((entryPrice - risk * 4).toFixed(4))
      };
    }
  }

  /**
   * 计算风险回报比
   */
  calculateRiskReward(entryPrice, stopLoss, takeProfit) {
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    
    if (risk === 0) return 0;
    return parseFloat((reward / risk).toFixed(2));
  }

  /**
   * 确定信号质量
   */
  determineSignalQuality(alignment, sweep, riskReward) {
    let score = 0;

    // 时间框架对齐分数
    score += alignment.strength * 0.3;

    // 对齐的时间框架数量
    const alignedCount = Math.max(alignment.bullishCount, alignment.bearishCount);
    score += alignedCount * 10;

    // 流动性清扫加分
    if (sweep) {
      score += 20;
    }

    // 风险回报比分数
    if (riskReward >= 3) {
      score += 30;
    } else if (riskReward >= 2) {
      score += 20;
    } else if (riskReward >= 1.5) {
      score += 10;
    }

    // 根据总分确定质量等级
    if (score >= 80) return SignalQuality.HIGH;
    if (score >= 60) return SignalQuality.MEDIUM;
    return SignalQuality.LOW;
  }

  /**
   * 计算置信度
   */
  calculateConfidence(alignment, sweep) {
    let confidence = alignment.strength / 100;
    
    // 流动性清扫增加置信度
    if (sweep) {
      confidence += 0.15;
    }

    // 更多时间框架对齐增加置信度
    const alignedCount = Math.max(alignment.bullishCount, alignment.bearishCount);
    confidence += (alignedCount - 2) * 0.05;

    return Math.min(confidence, 1.0);
  }

  /**
   * 提取时间框架分析
   */
  extractTimeframeAnalysis(analysis) {
    const timeframes = {};
    
    for (const [tf, data] of Object.entries(analysis)) {
      timeframes[tf] = {
        trend: data.trend || 'neutral',
        strength: data.strength || 50,
        price: data.currentPrice || data.close,
        displacement: data.displacement || null,
        orderBlocks: data.orderBlocks || []
      };
    }

    return timeframes;
  }

  /**
   * 查找现有信号
   */
  findExistingSignal(symbol, type) {
    for (const signal of this.signals.values()) {
      if (signal.symbol === symbol && 
          signal.type === type && 
          signal.status === SignalStatus.ACTIVE) {
        return signal;
      }
    }
    return null;
  }

  /**
   * 更新信号状态
   */
  updateSignalStatus() {
    const now = Date.now();
    
    for (const signal of this.signals.values()) {
      // 检查是否已过期
      if (now > new Date(signal.expiresAt).getTime()) {
        if (signal.status === SignalStatus.ACTIVE) {
          signal.status = SignalStatus.EXPIRED;
          signal.updates.push({
            timestamp: now,
            status: SignalStatus.EXPIRED,
            message: 'Signal expired'
          });
          logger.info(`Signal expired: ${signal.id}`);
        }
      }
    }
  }

  /**
   * 清理过期信号
   */
  cleanExpiredSignals() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24小时
    
    for (const [id, signal] of this.signals.entries()) {
      if (now - signal.timestamp > maxAge) {
        this.signals.delete(id);
      }
    }
  }

  /**
   * 添加到历史记录
   */
  addToHistory(signal) {
    this.signalHistory.push({
      id: signal.id,
      symbol: signal.symbol,
      type: signal.type,
      status: signal.status,
      quality: signal.quality,
      timestamp: signal.timestamp,
      createdAt: signal.createdAt
    });

    // 限制历史记录大小
    if (this.signalHistory.length > this.maxHistorySize) {
      this.signalHistory = this.signalHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * 获取活跃信号
   */
  getActiveSignals() {
    return Array.from(this.signals.values())
      .filter(s => s.status === SignalStatus.ACTIVE)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 获取所有信号
   */
  getAllSignals() {
    return Array.from(this.signals.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 获取信号历史
   */
  getSignalHistory(limit = 100) {
    return this.signalHistory
      .slice(-limit)
      .reverse();
  }

  /**
   * 获取信号统计
   */
  getStatistics() {
    const allSignals = Array.from(this.signals.values());
    const activeSignals = allSignals.filter(s => s.status === SignalStatus.ACTIVE);
    
    const stats = {
      total: allSignals.length,
      active: activeSignals.length,
      expired: allSignals.filter(s => s.status === SignalStatus.EXPIRED).length,
      triggered: allSignals.filter(s => s.status === SignalStatus.TRIGGERED).length,
      invalidated: allSignals.filter(s => s.status === SignalStatus.INVALIDATED).length,
      
      byType: {
        long: allSignals.filter(s => s.type === SignalType.LONG).length,
        short: allSignals.filter(s => s.type === SignalType.SHORT).length
      },
      
      byQuality: {
        high: allSignals.filter(s => s.quality === SignalQuality.HIGH).length,
        medium: allSignals.filter(s => s.quality === SignalQuality.MEDIUM).length,
        low: allSignals.filter(s => s.quality === SignalQuality.LOW).length
      },
      
      byStatus: {
        active: activeSignals.length,
        pending: allSignals.filter(s => s.status === SignalStatus.PENDING).length,
        expired: allSignals.filter(s => s.status === SignalStatus.EXPIRED).length,
        triggered: allSignals.filter(s => s.status === SignalStatus.TRIGGERED).length,
        invalidated: allSignals.filter(s => s.status === SignalStatus.INVALIDATED).length
      }
    };

    return stats;
  }

  /**
   * 根据ID获取信号
   */
  getSignalById(id) {
    return this.signals.get(id) || null;
  }

  /**
   * 更新信号
   */
  updateSignal(id, updates) {
    const signal = this.signals.get(id);
    if (!signal) {
      return null;
    }

    const now = Date.now();
    
    // 应用更新
    Object.assign(signal, updates);
    
    // 记录更新历史
    signal.updates.push({
      timestamp: now,
      ...updates,
      message: updates.message || 'Signal updated'
    });

    logger.info(`Signal updated: ${id}`, updates);
    return signal;
  }

  /**
   * 标记信号为已触发
   */
  markAsTriggered(id, triggerPrice) {
    return this.updateSignal(id, {
      status: SignalStatus.TRIGGERED,
      triggeredAt: new Date().toISOString(),
      triggeredPrice: triggerPrice,
      message: `Signal triggered at ${triggerPrice}`
    });
  }

  /**
   * 标记信号为已失效
   */
  markAsInvalidated(id, reason) {
    return this.updateSignal(id, {
      status: SignalStatus.INVALIDATED,
      invalidatedAt: new Date().toISOString(),
      invalidatedReason: reason,
      message: `Signal invalidated: ${reason}`
    });
  }
}

// 创建单例实例
const scanner = new MTFScanner();

module.exports = {
  MTFScanner,
  scanner,
  SignalStatus,
  SignalType,
  SignalQuality
};
