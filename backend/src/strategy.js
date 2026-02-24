const CONFIG = {
  SWING_LOOKBACK: 5, FVG_MIN_SIZE_PERCENT: 0.1,
  SWEP_WICK_RATIO: 2.0, TREND_MA_PERIOD: 20,
  SCORE_THRESHOLDS: { S: 85, A: 70, B: 55, C: 40 },
  MIN_RRR: 2.0, MAX_RISK_PER_TRADE: 0.01, DEFAULT_LEVERAGE: 3,
  SIGNAL_TTL_HOURS: 4, MIN_SIGNAL_INTERVAL_HOURS: 4
};
function calculateATR(klines, period = 14) {
  if (klines.length < period + 1) return 0;
  const tr = [];
  for (let i = 1; i < klines.length; i++) {
    const c = klines[i], p = klines[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return tr.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function calculateRSI(klines, period = 14) {
  if (klines.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = klines.length - period; i < klines.length; i++) {
    const ch = klines[i].close - klines[i - 1].close;
    if (ch > 0) gains += ch; else losses += Math.abs(ch);
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}
function findSwingPoints(klines, lookback = 5) {
  const highs = [], lows = [];
  for (let i = lookback; i < klines.length - lookback; i++) {
    const c = klines[i];
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (klines[i - j].high >= c.high || klines[i + j].high >= c.high) isHigh = false;
      if (klines[i - j].low <= c.low || klines[i + j].low <= c.low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: c.high, timestamp: c.timestamp });
    if (isLow) lows.push({ index: i, price: c.low, timestamp: c.timestamp });
  }
  return { swingHighs: highs, swingLows: lows };
}
function detectChoCH(klines, highs, lows) {
  if (highs.length < 2 || lows.length < 2) return null;
  const rHighs = highs.slice(-3), rLows = lows.slice(-3);
  if (rLows.length >= 2 && rLows[rLows.length - 1].price > rLows[rLows.length - 2].price) {
    return { type: 'BULLISH_CHOCH', level: rLows[rLows.length - 1].price };
  }
  if (rHighs.length >= 2 && rHighs[rHighs.length - 1].price < rHighs[rHighs.length - 2].price) {
    return { type: 'BEARISH_CHOCH', level: rHighs[rHighs.length - 1].price };
  }
  return null;
}
function detectFVG(klines) {
  const fvgs = [];
  for (let i = 2; i < klines.length; i++) {
    const k1 = klines[i - 2], k3 = klines[i];
    if (k1.high < k3.low) {
      const sz = k3.low - k1.high, mid = (k1.high + k3.low) / 2;
      if ((sz / mid) * 100 >= CONFIG.FVG_MIN_SIZE_PERCENT) {
        fvgs.push({ type: 'BULLISH_FVG', top: k3.low, bottom: k1.high, size: sz });
      }
    }
    if (k1.low > k3.high) {
      const sz = k1.low - k3.high, mid = (k1.low + k3.high) / 2;
      if ((sz / mid) * 100 >= CONFIG.FVG_MIN_SIZE_PERCENT) {
        fvgs.push({ type: 'BEARISH_FVG', top: k1.low, bottom: k3.high, size: sz });
      }
    }
  }
  return fvgs;
}
function detectSweep(klines) {
  if (klines.length < 10) return null;
  const { swingHighs: h, swingLows: l } = findSwingPoints(klines, 3);
  if (h.length < 2 || l.length < 2) return null;
  const r = klines.slice(-5), rh = h[h.length - 1], rl = l[l.length - 1];
  for (const k of r) {
    const wAbove = k.high - Math.max(k.open, k.close), body = Math.abs(k.close - k.open);
    if (k.high > rh.price && wAbove > body * CONFIG.SWEP_WICK_RATIO && k.close < rh.price) {
      return { type: 'HIGH_SWEEP', direction: 'BEARISH', sweptLevel: rh.price };
    }
    const wBelow = Math.min(k.open, k.close) - k.low;
    if (k.low < rl.price && wBelow > body * CONFIG.SWEP_WICK_RATIO && k.close > rl.price) {
      return { type: 'LOW_SWEEP', direction: 'BULLISH', sweptLevel: rl.price };
    }
  }
  return null;
}
function detectOrderBlocks(klines) {
  const obs = [];
  for (let i = 3; i < klines.length - 1; i++) {
    const k0 = klines[i - 1], k1 = klines[i], k2 = klines[i + 1];
    if (k0.close < k0.open && k1.close > k1.open && k1.close > k0.high && k2.close > k2.open) {
      obs.push({ type: 'BULLISH_OB', high: k1.high, low: k1.low, strength: (k1.close - k1.open) / k1.open });
    }
    if (k0.close > k0.open && k1.close < k1.open && k1.close < k0.low && k2.close < k2.open) {
      obs.push({ type: 'BEARISH_OB', high: k1.high, low: k1.low, strength: (k1.open - k1.close) / k1.open });
    }
  }
  return obs;
}
function determineTrendDetailed(klines) {
  if (klines.length < CONFIG.TREND_MA_PERIOD) return { direction: 'NEUTRAL', strength: 0, confidence: 'low' };
  const recent = klines.slice(-CONFIG.TREND_MA_PERIOD);
  const sma = recent.reduce((s, k) => s + k.close, 0) / CONFIG.TREND_MA_PERIOD;
  const cur = klines[klines.length - 1].close;
  const ch = (cur - sma) / sma;
  let dir = 'NEUTRAL', conf = 'medium';
  if (ch > 0.02) dir = 'BULLISH';
  else if (ch > 0.005) dir = 'WEAK_BULLISH';
  else if (ch < -0.02) dir = 'BEARISH';
  else if (ch < -0.005) dir = 'WEAK_BEARISH';
  const rsi = calculateRSI(klines, 14);
  if ((dir === 'BULLISH' && rsi > 50) || (dir === 'BEARISH' && rsi < 50)) conf = 'high';
  return { direction: dir, strength: Math.abs(ch), confidence: conf, rsi, sma };
}
function frequencyFilter(symbol, recentSignals) {
  const now = Date.now();
  const cutoff = now - CONFIG.MIN_SIGNAL_INTERVAL_HOURS * 3600 * 1000;
  const recent = recentSignals.filter(s => s.symbol === symbol && new Date(s.timestamp).getTime() > cutoff);
  if (recent.length > 0) return { passed: false, reason: 'FREQUENCY_LIMIT' };
  return { passed: true };
}
function environmentFilter(klines, direction, ticker) {
  const checks = [
    { name: 'volume', passed: ticker && ticker.volume24h > 500000 },
    { name: 'volatility', passed: true },
    { name: 'trend', passed: true }
  ];
  return { passed: checks.every(c => c.passed), checks };
}
function degradationFilter(signal, klines, ticker) {
  let score = signal.baseScore || 70;
  const penalties = [];
  if (ticker && ticker.volume24h < 400000) { score -= 10; penalties.push({ reason: 'LOW_VOLUME', penalty: 10 }); }
  return { originalScore: signal.baseScore || 70, adjustedScore: Math.max(0, score), penalties };
}
function riskManagementCheck(signal, balance = 10000) {
  const checks = [{ name: 'rrr', passed: signal.rrr >= CONFIG.MIN_RRR }];
  const risk = balance * CONFIG.MAX_RISK_PER_TRADE;
  const slPct = Math.abs(signal.entry_price - signal.sl) / signal.entry_price;
  const pos = risk / (signal.entry_price * slPct);
  const lev = Math.min(CONFIG.DEFAULT_LEVERAGE, Math.floor(1 / slPct));
  return { executionStatus: checks.every(c => c.passed) ? 'PASS' : 'BLOCK', checks, positionSize: Math.floor(pos), leverage: lev };
}
function scanAllSymbols(klinesData, tickersData, scanHistory = []) {
  const signals = [], filtered = [];
  for (const [symbol, klines] of Object.entries(klinesData)) {
    try {
      const ticker = tickersData ? tickersData[symbol] : null;
      if (!frequencyFilter(symbol, scanHistory).passed) { filtered.push({ symbol, reason: 'FREQUENCY_LIMIT' }); continue; }
      const { swingHighs, swingLows } = findSwingPoints(klines);
      const choch = detectChoCH(klines, swingHighs, swingLows);
      const fvgList = detectFVG(klines);
      const sweep = detectSweep(klines);
      const obs = detectOrderBlocks(klines);
      const trend = determineTrendDetailed(klines);
      if (choch && fvgList.length > 0) {
        const direction = choch.type === 'BULLISH_CHOCH' ? 'LONG' : 'SHORT';
        if (!environmentFilter(klines, direction, ticker).passed) { filtered.push({ symbol, reason: 'ENV_FILTER' }); continue; }
        const entry = klines[klines.length - 1].close;
        const atr = calculateATR(klines, 14);
        let sl, tp1, tp2;
        if (direction === 'LONG') {
          sl = Math.min(fvgList[fvgList.length - 1].bottom, swingLows[swingLows.length - 1]?.price || entry * 0.95);
          tp1 = entry + (entry - sl) * 2; tp2 = entry + (entry - sl) * 3;
        } else {
          sl = Math.max(fvgList[fvgList.length - 1].top, swingHighs[swingHighs.length - 1]?.price || entry * 1.05);
          tp1 = entry - (sl - entry) * 2; tp2 = entry - (sl - entry) * 3;
        }
        const rrr = Math.abs(tp1 - entry) / Math.abs(entry - sl);
        let baseScore = 70;
        if (sweep) baseScore += 10;
        if (obs.length > 0) baseScore += 5;
        if (trend.confidence === 'high') baseScore += 10;
        const deg = degradationFilter({ baseScore, entry_price: entry, choch }, klines, ticker);
        const risk = riskManagementCheck({ entry_price: entry, sl, rrr });
        if (risk.executionStatus === 'BLOCK') { filtered.push({ symbol, reason: 'RISK_CHECK' }); continue; }
        let rating = 'C';
        if (deg.adjustedScore >= CONFIG.SCORE_THRESHOLDS.S) rating = 'S';
        else if (deg.adjustedScore >= CONFIG.SCORE_THRESHOLDS.A) rating = 'A';
        else if (deg.adjustedScore >= CONFIG.SCORE_THRESHOLDS.B) rating = 'B';
        signals.push({
          id: `${symbol}_${Date.now()}`, symbol, direction, entry_price: entry, sl, tp1, tp2, rrr, rating,
          score: deg.adjustedScore, choch, fvg: fvgList[fvgList.length - 1], sweep, order_blocks: obs.slice(-2),
          trend, risk_management: risk, timestamp: new Date().toISOString(), timeframe: '4h'
        });
      }
    } catch (e) { console.error(`Error analyzing ${symbol}:`, e.message); }
  }
  return { signals, filtered };
}
module.exports = {
  CONFIG, calculateATR, calculateRSI, findSwingPoints, detectChoCH, detectFVG,
  detectSweep, detectOrderBlocks, determineTrendDetailed, frequencyFilter,
  environmentFilter, degradationFilter, riskManagementCheck, scanAllSymbols
};
