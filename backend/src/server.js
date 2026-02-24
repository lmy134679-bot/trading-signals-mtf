/**
 * Trading Signals MTF - API Server
 * 多时间框架交易信号系统后端服务
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { scanner, SignalStatus, SignalType, SignalQuality } = require('./mtfScanner');
const logger = require('./utils/logger');

// 创建 Express 应用
const app = express();
const PORT = process.env.PORT || 3000;

// 安全中间件
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS 配置 - 允许前端访问
const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://*.kimi.link',
    'https://*.railway.app',
    '*' // 开发阶段允许所有来源
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));

// 压缩响应
app.use(compression());

// 解析 JSON
app.use(express.json());

// 速率限制
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 100, // 每分钟最多100个请求
  message: { error: 'Too many requests, please try again later.' }
});
app.use(limiter);

// 请求日志中间件
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

// ==================== API 路由 ====================

/**
 * 健康检查
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

/**
 * 获取活跃信号列表
 */
app.get('/api/signals', (req, res) => {
  try {
    const { type, quality, status, symbol } = req.query;
    
    let signals = scanner.getActiveSignals();
    
    // 应用过滤器
    if (type) {
      signals = signals.filter(s => s.type === type.toLowerCase());
    }
    
    if (quality) {
      signals = signals.filter(s => s.quality === quality.toLowerCase());
    }
    
    if (status) {
      signals = signals.filter(s => s.status === status.toLowerCase());
    }
    
    if (symbol) {
      signals = signals.filter(s => s.symbol.toLowerCase() === symbol.toLowerCase());
    }

    res.json({
      success: true,
      count: signals.length,
      signals: signals.map(s => ({
        id: s.id,
        symbol: s.symbol,
        type: s.type,
        status: s.status,  // 确保 status 字段返回
        quality: s.quality,
        confidence: s.confidence,
        entryPrice: s.entryPrice,
        stopLoss: s.stopLoss,
        takeProfits: s.takeProfits,
        riskReward: s.riskReward,
        timestamp: s.timestamp,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        timeframeAlignment: s.timeframeAlignment,
        liquiditySweep: s.liquiditySweep,
        metadata: s.metadata
      }))
    });
  } catch (error) {
    logger.error('Error fetching signals:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch signals'
    });
  }
});

/**
 * 获取所有信号（包括非活跃）
 */
app.get('/api/signals/all', (req, res) => {
  try {
    const signals = scanner.getAllSignals();
    
    res.json({
      success: true,
      count: signals.length,
      signals: signals.map(s => ({
        id: s.id,
        symbol: s.symbol,
        type: s.type,
        status: s.status,  // 确保 status 字段返回
        quality: s.quality,
        confidence: s.confidence,
        entryPrice: s.entryPrice,
        stopLoss: s.stopLoss,
        takeProfits: s.takeProfits,
        riskReward: s.riskReward,
        timestamp: s.timestamp,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        triggeredAt: s.triggeredAt,
        invalidatedAt: s.invalidatedAt,
        invalidatedReason: s.invalidatedReason
      }))
    });
  } catch (error) {
    logger.error('Error fetching all signals:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch signals'
    });
  }
});

/**
 * 获取单个信号详情
 */
app.get('/api/signals/:id', (req, res) => {
  try {
    const { id } = req.params;
    const signal = scanner.getSignalById(id);
    
    if (!signal) {
      return res.status(404).json({
        success: false,
        error: 'Signal not found'
      });
    }

    res.json({
      success: true,
      signal: {
        id: signal.id,
        symbol: signal.symbol,
        type: signal.type,
        status: signal.status,  // 确保 status 字段返回
        quality: signal.quality,
        confidence: signal.confidence,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfits: signal.takeProfits,
        riskReward: signal.riskReward,
        timestamp: signal.timestamp,
        createdAt: signal.createdAt,
        expiresAt: signal.expiresAt,
        timeframeAlignment: signal.timeframeAlignment,
        liquiditySweep: signal.liquiditySweep,
        timeframes: signal.timeframes,
        metadata: signal.metadata,
        updates: signal.updates
      }
    });
  } catch (error) {
    logger.error('Error fetching signal:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch signal'
    });
  }
});

/**
 * 获取信号统计
 */
app.get('/api/statistics', (req, res) => {
  try {
    const stats = scanner.getStatistics();
    
    res.json({
      success: true,
      statistics: stats,
      scanCount: scanner.scanCount,
      isScanning: scanner.isScanning,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

/**
 * 获取信号历史
 */
app.get('/api/history', (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const history = scanner.getSignalHistory(parseInt(limit));
    
    res.json({
      success: true,
      count: history.length,
      history
    });
  } catch (error) {
    logger.error('Error fetching history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch history'
    });
  }
});

/**
 * 手动触发扫描
 */
app.post('/api/scan', async (req, res) => {
  try {
    logger.info('Manual scan triggered');
    const result = await scanner.scan();
    
    res.json({
      success: true,
      result
    });
  } catch (error) {
    logger.error('Error during manual scan:', error);
    res.status(500).json({
      success: false,
      error: 'Scan failed'
    });
  }
});

/**
 * 更新信号状态
 */
app.put('/api/signals/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const signal = scanner.updateSignal(id, updates);
    
    if (!signal) {
      return res.status(404).json({
        success: false,
        error: 'Signal not found'
      });
    }

    res.json({
      success: true,
      signal: {
        id: signal.id,
        symbol: signal.symbol,
        type: signal.type,
        status: signal.status,
        quality: signal.quality,
        updates: signal.updates
      }
    });
  } catch (error) {
    logger.error('Error updating signal:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update signal'
    });
  }
});

/**
 * 获取系统状态
 */
app.get('/api/status', (req, res) => {
  try {
    const activeSignals = scanner.getActiveSignals();
    
    res.json({
      success: true,
      status: {
        isScanning: scanner.isScanning,
        scanCount: scanner.scanCount,
        activeSignals: activeSignals.length,
        totalSignals: scanner.signals?.size || 0,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error fetching status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch status'
    });
  }
});

/**
 * 获取常量定义
 */
app.get('/api/constants', (req, res) => {
  res.json({
    success: true,
    constants: {
      SignalStatus: Object.keys(SignalStatus).reduce((acc, key) => {
        acc[key] = SignalStatus[key];
        return acc;
      }, {}),
      SignalType: Object.keys(SignalType).reduce((acc, key) => {
        acc[key] = SignalType[key];
        return acc;
      }, {}),
      SignalQuality: Object.keys(SignalQuality).reduce((acc, key) => {
        acc[key] = SignalQuality[key];
        return acc;
      }, {})
    }
  });
});

// ==================== 错误处理 ====================

// 404 处理
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path
  });
});

// 全局错误处理
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// ==================== 启动服务 ====================

// 生成模拟信号（用于演示）
function generateMockSignals() {
  const symbols = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT'];
  const types = ['long', 'short'];
  const qualities = ['high', 'medium', 'low'];
  const statuses = ['active', 'pending', 'triggered'];
  
  logger.info('Generating mock signals for demonstration...');
  
  for (let i = 0; i < 8; i++) {
    const symbol = symbols[i % symbols.length];
    const type = types[i % types.length];
    const quality = qualities[i % qualities.length];
    const basePrice = symbol.includes('BTC') ? 65000 : 
                      symbol.includes('ETH') ? 3500 : 
                      symbol.includes('SOL') ? 150 : 0.5;
    
    const entryPrice = basePrice * (1 + (Math.random() - 0.5) * 0.02);
    const stopDistance = entryPrice * 0.015;
    const stopLoss = type === 'long' ? entryPrice - stopDistance : entryPrice + stopDistance;
    const tp1 = type === 'long' ? entryPrice + stopDistance * 1.5 : entryPrice - stopDistance * 1.5;
    const tp2 = type === 'long' ? entryPrice + stopDistance * 2.5 : entryPrice - stopDistance * 2.5;
    const tp3 = type === 'long' ? entryPrice + stopDistance * 4 : entryPrice - stopDistance * 4;
    
    const now = Date.now();
    const signal = {
      id: `sig_${symbol}_${now}_${i}`,
      symbol,
      type,
      status: 'active',  // 关键：确保 status 字段
      quality,
      confidence: 0.6 + Math.random() * 0.35,
      entryPrice: parseFloat(entryPrice.toFixed(4)),
      stopLoss: parseFloat(stopLoss.toFixed(4)),
      takeProfits: {
        tp1: parseFloat(tp1.toFixed(4)),
        tp2: parseFloat(tp2.toFixed(4)),
        tp3: parseFloat(tp3.toFixed(4))
      },
      riskReward: parseFloat((1.5 + Math.random() * 2.5).toFixed(2)),
      timestamp: now,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
      timeframeAlignment: {
        isAligned: true,
        direction: type === 'long' ? 'bullish' : 'bearish',
        strength: 60 + Math.floor(Math.random() * 30),
        bullishCount: type === 'long' ? 3 : 1,
        bearishCount: type === 'short' ? 3 : 1,
        totalTimeframes: 4,
        alignedTimeframes: [
          { timeframe: '15m', direction: type === 'long' ? 'bullish' : 'bearish', strength: 70 },
          { timeframe: '1h', direction: type === 'long' ? 'bullish' : 'bearish', strength: 75 },
          { timeframe: '4h', direction: type === 'long' ? 'bullish' : 'bearish', strength: 65 }
        ]
      },
      liquiditySweep: Math.random() > 0.5 ? {
        type: type === 'long' ? 'bearish' : 'bullish',
        price: parseFloat((entryPrice * (1 + (Math.random() - 0.5) * 0.01)).toFixed(4)),
        strength: 'medium',
        timestamp: new Date(now - 5 * 60 * 1000).toISOString()
      } : null,
      metadata: {
        scanCount: 1,
        timeframeCount: 4,
        alignedTimeframes: ['15m', '1h', '4h']
      },
      updates: [{
        timestamp: now,
        status: 'active',
        message: 'Signal created'
      }]
    };
    
    // 直接添加到 scanner 的 signals Map
    if (scanner.signals) {
      scanner.signals.set(signal.id, signal);
    }
  }
  
  logger.info(`Generated ${scanner.signals?.size || 0} mock signals`);
}

// 启动服务器
app.listen(PORT, () => {
  logger.info(`=================================`);
  logger.info(`Trading Signals MTF API Server`);
  logger.info(`=================================`);
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`API base: http://localhost:${PORT}/api`);
  
  // 生成模拟信号
  generateMockSignals();
  
  // 启动扫描器
  // scanner.start(); // 暂时不启动实时扫描，使用模拟信号
  
  logger.info('Server ready!');
});

// 优雅关闭
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  scanner.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  scanner.stop();
  process.exit(0);
});

module.exports = app;
