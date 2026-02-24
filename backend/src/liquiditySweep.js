const { findSwingPoints } = require('./strategy');
const SWEEP_CONFIG = { WICK_RATIO: 2.0, CONFIRMATION_REQUIRED: true, VALIDITY_WINDOW: 5, MIN_SWEEP_PERCENT: 0.1 };
function identifyLiquidityPools(klines) {
  const { swingHighs, swingLows } = findSwingPoints(klines, 3);
  const pools = { buySide: [], sellSide: [] };
  swingHighs.slice(-5).forEach((s, i) => pools.buySide.push({ type: 'SWING_HIGH', level: s.price, priority: i === swingHighs.length - 1 ? 'high' : 'medium' }));
  swingLows.slice(-5).forEach((s, i) => pools.sellSide.push({ type: 'SWING_LOW', level: s.price, priority: i === swingLows.length - 1 ? 'high' : 'medium' }));
  return pools;
}
function detectLiquiditySweep(klines, pools, dir) {
  const recent = klines.slice(-SWEEP_CONFIG.VALIDITY_WINDOW);
  if (dir === 'LONG') return detectSellSideSweep(recent, pools.sellSide);
  if (dir === 'SHORT') return detectBuySideSweep(recent, pools.buySide);
  return { detected: false };
}
function detectSellSideSweep(klines, pools) {
  if (!pools || pools.length === 0) return { detected: false };
  const target = pools.find(p => p.priority === 'high') || pools[0];
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i], body = Math.abs(k.close - k.open), wick = Math.min(k.open, k.close) - k.low;
    const swept = k.low < target.level, wickOk = body > 0 && wick > body * SWEEP_CONFIG.WICK_RATIO, reclaim = k.close > target.level;
    const sweepSize = target.level - k.low, sweepPct = (sweepSize / target.level) * 100;
    if (swept && wickOk && reclaim && sweepPct >= SWEEP_CONFIG.MIN_SWEEP_PERCENT) {
      return { detected: true, type: 'SELL_SIDE_SWEEP', pool: target, sweepMetrics: { wickLength: wick, wickToBodyRatio: wick / body, sweepPercent: sweepPct } };
    }
  }
  return { detected: false };
}
function detectBuySideSweep(klines, pools) {
  if (!pools || pools.length === 0) return { detected: false };
  const target = pools.find(p => p.priority === 'high') || pools[0];
  for (let i = 0; i < klines.length; i++) {
    const k = klines[i], body = Math.abs(k.close - k.open), wick = k.high - Math.max(k.open, k.close);
    const swept = k.high > target.level, wickOk = body > 0 && wick > body * SWEEP_CONFIG.WICK_RATIO, reclaim = k.close < target.level;
    const sweepSize = k.high - target.level, sweepPct = (sweepSize / target.level) * 100;
    if (swept && wickOk && reclaim && sweepPct >= SWEEP_CONFIG.MIN_SWEEP_PERCENT) {
      return { detected: true, type: 'BUY_SIDE_SWEEP', pool: target, sweepMetrics: { wickLength: wick, wickToBodyRatio: wick / body, sweepPercent: sweepPct } };
    }
  }
  return { detected: false };
}
function requireLiquiditySweep(klines, dir) {
  const pools = identifyLiquidityPools(klines);
  const result = detectLiquiditySweep(klines, pools, dir);
  return {
    passed: result.detected, required: SWEEP_CONFIG.CONFIRMATION_REQUIRED,
    check: { poolsIdentified: pools, sweepDetected: result.detected, sweepDetails: result.detected ? result : null },
    signalImpact: result.detected ? { action: 'ALLOW', ratingBoost: 10 } : { action: SWEEP_CONFIG.CONFIRMATION_REQUIRED ? 'BLOCK' : 'DOWNGRADE' }
  };
}
module.exports = { SWEEP_CONFIG, identifyLiquidityPools, detectLiquiditySweep, requireLiquiditySweep };
