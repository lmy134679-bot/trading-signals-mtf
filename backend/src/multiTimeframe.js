const { findSwingPoints, detectChoCH, detectFVG, detectOrderBlocks, determineTrendDetailed, calculateATR } = require('./strategy');
const MTF_CONFIG = {
  TIMEFRAMES: { HTF: { name: '4h' }, MTF: { name: '15m' }, LTF: { name: '1m' } },
  ALIGNMENT_GATE: { enabled: true, strictMode: true }
};
function analyzeHTF(klines) {
  if (!klines || klines.length < 20) return { valid: false, reason: 'INSUFFICIENT_DATA', direction: 'NEUTRAL' };
  const { swingHighs, swingLows } = findSwingPoints(klines, 5);
  const trend = determineTrendDetailed(klines);
  const fvgList = detectFVG(klines);
  const obs = detectOrderBlocks(klines);
  let direction = 'NEUTRAL';
  if (trend.direction === 'BULLISH' || trend.direction === 'WEAK_BULLISH') direction = 'LONG';
  else if (trend.direction === 'BEARISH' || trend.direction === 'WEAK_BEARISH') direction = 'SHORT';
  const poiList = [];
  fvgList.slice(-3).forEach(fvg => {
    const cur = klines[klines.length - 1].close;
    poiList.push({ type: 'FVG', subtype: fvg.type, top: fvg.top, bottom: fvg.bottom, tested: direction === 'LONG' ? cur <= fvg.top : cur >= fvg.bottom, priority: fvg.sizePercent > 0.5 ? 'high' : 'medium' });
  });
  obs.slice(-2).forEach(ob => poiList.push({ type: 'ORDER_BLOCK', subtype: ob.type, top: ob.high, bottom: ob.low, tested: false, priority: ob.strength > 0.02 ? 'high' : 'medium' }));
  if (swingHighs.length > 0) poiList.push({ type: 'LIQUIDITY_POOL', subtype: 'BUY_SIDE', level: swingHighs[swingHighs.length - 1].price, priority: 'high' });
  if (swingLows.length > 0) poiList.push({ type: 'LIQUIDITY_POOL', subtype: 'SELL_SIDE', level: swingLows[swingLows.length - 1].price, priority: 'high' });
  return { valid: true, direction, trend, swingHighs, swingLows, poi: poiList, fvg: fvgList.slice(-3), orderBlocks: obs.slice(-2), currentPrice: klines[klines.length - 1].close, atr: calculateATR(klines, 14) };
}
function analyzeMTF(klines, htfDirection, htfPOI) {
  if (!klines || klines.length < 20) return { valid: false, reason: 'INSUFFICIENT_DATA', direction: 'NEUTRAL', aligned: false };
  const { swingHighs, swingLows } = findSwingPoints(klines, 3);
  const choch = detectChoCH(klines, swingHighs, swingLows);
  const fvgList = detectFVG(klines);
  const bos = detectBOS(klines, swingHighs, swingLows);
  const strongClose = bos ? confirmStrongClose(klines, bos) : false;
  let direction = 'NEUTRAL';
  if (choch) direction = choch.type === 'BULLISH_CHOCH' ? 'LONG' : 'SHORT';
  else if (bos) direction = bos.type === 'BULLISH_BOS' ? 'LONG' : 'SHORT';
  const cur = klines[klines.length - 1].close;
  const inPOI = htfPOI.some(p => (p.type === 'FVG' || p.type === 'ORDER_BLOCK') && cur >= p.bottom && cur <= p.top);
  const aligned = direction === htfDirection || htfDirection === 'NEUTRAL';
  return { valid: true, direction, choch, bos, strongCloseConfirmed: strongClose, swingHighs, swingLows, fvg: fvgList.slice(-2), inHTFPOI: inPOI, aligned, alignmentCheck: { htfDirection, mtfDirection: direction, conflict: !aligned && direction !== 'NEUTRAL' } };
}
function analyzeLTF(klines, htfDir, mtfDir, mtfFVG) {
  if (!klines || klines.length < 20) return { valid: false, reason: 'INSUFFICIENT_DATA', direction: 'NEUTRAL', aligned: false };
  const { swingHighs, swingLows } = findSwingPoints(klines, 2);
  const choch = detectChoCH(klines, swingHighs, swingLows);
  const sweep = detectSweep(klines);
  const fvgList = detectFVG(klines);
  const ibos = detectInternalBOS(klines, swingHighs, swingLows);
  const hilo = detectHiLoTwo(klines, htfDir);
  let dir = 'NEUTRAL';
  if (choch) dir = choch.type === 'BULLISH_CHOCH' ? 'LONG' : 'SHORT';
  else if (ibos) dir = ibos.type === 'BULLISH_INTERNAL_BOS' ? 'LONG' : 'SHORT';
  const aligned = dir === htfDir && dir === mtfDir;
  const cur = klines[klines.length - 1].close;
  const inZone = mtfFVG && mtfFVG.length > 0 ? cur >= mtfFVG[mtfFVG.length - 1].bottom && cur <= mtfFVG[mtfFVG.length - 1].top : false;
  return { valid: true, direction: dir, choch, sweep, internalBOS: ibos, hiloCount: hilo, fvg: fvgList.slice(-2), inEntryZone: inZone, aligned };
}
function detectBOS(klines, highs, lows) {
  if (highs.length < 2 || lows.length < 2) return null;
  const last = klines[klines.length - 1];
  const ph = highs[highs.length - 2], pl = lows[lows.length - 2];
  const bodyTop = Math.max(last.open, last.close), bodyBot = Math.min(last.open, last.close);
  if (bodyTop > ph.price && last.close > ph.price) return { type: 'BULLISH_BOS', brokenLevel: ph.price, bodyBreak: true };
  if (bodyBot < pl.price && last.close < pl.price) return { type: 'BEARISH_BOS', brokenLevel: pl.price, bodyBreak: true };
  return null;
}
function confirmStrongClose(klines, bos) {
  if (klines.length < 2) return false;
  const c = klines[klines.length - 1];
  const pos = bos.type === 'BULLISH_BOS' ? c.close > bos.brokenLevel : c.close < bos.brokenLevel;
  const mom = bos.type === 'BULLISH_BOS' ? c.close > c.open : c.close < c.open;
  return pos && mom;
}
function detectInternalBOS(klines, highs, lows) {
  const recent = klines.slice(-10);
  const { swingHighs: ih, swingLows: il } = findSwingPoints(recent, 2);
  const last = klines[klines.length - 1];
  if (ih.length >= 2 && last.close > ih[ih.length - 2].price) return { type: 'BULLISH_INTERNAL_BOS', brokenLevel: ih[ih.length - 2].price };
  if (il.length >= 2 && last.close < il[il.length - 2].price) return { type: 'BEARISH_INTERNAL_BOS', brokenLevel: il[il.length - 2].price };
  return null;
}
function detectHiLoTwo(klines, dir) {
  if (klines.length < 10) return { valid: false };
  const recent = klines.slice(-10);
  return dir === 'LONG' ? countHighs(recent) : countLows(recent);
}
function countHighs(klines) {
  let h1 = -1, h2 = -1, pb = -1;
  for (let i = 1; i < klines.length; i++) {
    if (h1 === -1 && klines[i].high > klines[i - 1].high) { h1 = i; continue; }
    if (h1 !== -1 && pb === -1 && klines[i].high < klines[h1].high) { pb = i; continue; }
    if (h1 !== -1 && pb !== -1 && klines[i].high > klines[pb].high) { h2 = i; break; }
  }
  const ranging = checkRanging(klines);
  if (h2 !== -1 && !ranging) return { valid: true, type: 'HIGH_TWO', highOneIndex: h1, pullbackIndex: pb, highTwoIndex: h2, entryPrice: klines[h2].high * 1.001, stopLoss: Math.min(...klines.slice(pb, h2).map(k => k.low)) * 0.999 };
  if (ranging) return { valid: false, type: h1 !== -1 ? 'HIGH_ONE' : 'NONE', countingPaused: true, pauseReason: 'PRICE_RANGING' };
  return { valid: false, type: h1 !== -1 ? 'HIGH_ONE' : 'NONE' };
}
function countLows(klines) {
  let l1 = -1, l2 = -1, pb = -1;
  for (let i = 1; i < klines.length; i++) {
    if (l1 === -1 && klines[i].low < klines[i - 1].low) { l1 = i; continue; }
    if (l1 !== -1 && pb === -1 && klines[i].low > klines[l1].low) { pb = i; continue; }
    if (l1 !== -1 && pb !== -1 && klines[i].low < klines[pb].low) { l2 = i; break; }
  }
  const ranging = checkRanging(klines);
  if (l2 !== -1 && !ranging) return { valid: true, type: 'LOW_TWO', lowOneIndex: l1, pullbackIndex: pb, lowTwoIndex: l2, entryPrice: klines[l2].low * 0.999, stopLoss: Math.max(...klines.slice(pb, l2).map(k => k.high)) * 1.001 };
  if (ranging) return { valid: false, type: l1 !== -1 ? 'LOW_ONE' : 'NONE', countingPaused: true, pauseReason: 'PRICE_RANGING' };
  return { valid: false, type: l1 !== -1 ? 'LOW_ONE' : 'NONE' };
}
function checkRanging(klines) {
  if (klines.length < 8) return false;
  const r = klines.slice(-8);
  const maxH = Math.max(...r.map(k => k.high)), minL = Math.min(...r.map(k => k.low));
  const range = maxH - minL, mid = (maxH + minL) / 2;
  return (range / mid) * 100 < 1.5;
}
function checkPriceInPOI(price, poiList) {
  if (!poiList || poiList.length === 0) return false;
  return poiList.some(p => (p.type === 'FVG' || p.type === 'ORDER_BLOCK') && price >= p.bottom && price <= p.top);
}
function checkAlignmentGate(htf, mtf, ltf) {
  const r = { passed: true, blocked: false, blockReason: null };
  if (!htf.valid) return { passed: false, blocked: true, blockReason: 'HTF_DATA_INVALID' };
  if (!mtf.valid) return { passed: false, blocked: true, blockReason: 'MTF_DATA_INVALID' };
  if (!ltf.valid) return { passed: false, blocked: true, blockReason: 'LTF_DATA_INVALID' };
  if (htf.direction === 'NEUTRAL') return { passed: false, blocked: true, blockReason: 'HTF_DIRECTION_NEUTRAL' };
  if (!mtf.aligned) return { passed: false, blocked: MTF_CONFIG.ALIGNMENT_GATE.strictMode, blockReason: 'MTF_NOT_ALIGNED' };
  if (!mtf.inHTFPOI) return { passed: false, blocked: MTF_CONFIG.ALIGNMENT_GATE.strictMode, blockReason: 'MTF_NOT_IN_HTF_POI' };
  if (!ltf.aligned) return { passed: false, blocked: MTF_CONFIG.ALIGNMENT_GATE.strictMode, blockReason: 'LTF_NOT_FULLY_ALIGNED' };
  if (!ltf.inEntryZone) return { passed: false, blockReason: 'LTF_NOT_IN_ENTRY_ZONE' };
  return r;
}
function analyzeMultiTimeframe(mtfData) {
  const htf = analyzeHTF(mtfData['4h']);
  const mtf = analyzeMTF(mtfData['15m'], htf.direction, htf.poi);
  const ltf = analyzeLTF(mtfData['1m'], htf.direction, mtf.direction, mtf.fvg);
  const gate = checkAlignmentGate(htf, mtf, ltf);
  return { htf, mtf, ltf, gate, aligned: gate.passed, canGenerateSignal: gate.passed && !gate.blocked, blockedReason: gate.blockReason };
}
module.exports = {
  MTF_CONFIG, analyzeHTF, analyzeMTF, analyzeLTF, analyzeMultiTimeframe,
  detectBOS, confirmStrongClose, detectInternalBOS, detectHiLoTwo, countHighs, countLows, checkRanging, checkPriceInPOI
};
