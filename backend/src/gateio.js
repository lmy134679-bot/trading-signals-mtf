const axios = require('axios');
const GATEIO_API_BASE = 'https://api.gateio.ws/api/v4';
const SYMBOLS_54 = [
  'BTC_USDT', 'ETH_USDT', 'BNB_USDT', 'SOL_USDT', 'XRP_USDT',
  'ADA_USDT', 'AVAX_USDT', 'DOT_USDT', 'MATIC_USDT', 'LINK_USDT',
  'UNI_USDT', 'LTC_USDT', 'NEAR_USDT', 'APT_USDT', 'ATOM_USDT',
  'ETC_USDT', 'XLM_USDT', 'FIL_USDT', 'ARB_USDT', 'OP_USDT',
  'SUI_USDT', 'SEI_USDT', 'TIA_USDT', 'STRK_USDT', 'PYTH_USDT',
  'JUP_USDT', 'WIF_USDT', 'BONK_USDT', 'PEPE_USDT', 'SHIB_USDT',
  'DOGE_USDT', 'FLOKI_USDT', 'MEME_USDT', 'ORDI_USDT', 'SATS_USDT',
  'RATS_USDT', 'CAT_USDT', 'AI_USDT', 'XAI_USDT', 'NFP_USDT',
  'MANTA_USDT', 'DYM_USDT', 'PIXEL_USDT', 'PORTAL_USDT', 'AEVO_USDT',
  'WLD_USDT', 'ARKM_USDT', 'TAO_USDT', 'FET_USDT', 'RNDR_USDT',
  'AGIX_USDT', 'IMX_USDT', 'GRT_USDT', 'LDO_USDT'
];
const TIMEFRAME_CONFIG = {
  '1m': { interval: '1m', limit: 200 },
  '5m': { interval: '5m', limit: 200 },
  '15m': { interval: '15m', limit: 200 },
  '1h': { interval: '1h', limit: 100 },
  '4h': { interval: '4h', limit: 100 },
  '1d': { interval: '1d', limit: 50 }
};
async function getKlines(symbol, timeframe = '4h', limit = 100) {
  try {
    const config = TIMEFRAME_CONFIG[timeframe];
    if (!config) throw new Error(`Unsupported timeframe: ${timeframe}`);
    const url = `${GATEIO_API_BASE}/spot/candlesticks`;
    const res = await axios.get(url, {
      params: { currency_pair: symbol, interval: config.interval, limit: limit || config.limit },
      timeout: 10000
    });
    if (!res.data || !Array.isArray(res.data)) return null;
    return res.data.map(c => ({
      timestamp: parseInt(c[0]) * 1000,
      volume: parseFloat(c[1]),
      close: parseFloat(c[2]),
      high: parseFloat(c[3]),
      low: parseFloat(c[4]),
      open: parseFloat(c[5])
    }));
  } catch (e) {
    console.error(`Error fetching klines for ${symbol}:`, e.message);
    return null;
  }
}
async function getAllKlines(timeframe = '4h', limit = 100) {
  const results = {};
  const batchSize = 5;
  for (let i = 0; i < SYMBOLS_54.length; i += batchSize) {
    const batch = SYMBOLS_54.slice(i, i + batchSize);
    await Promise.all(batch.map(async (s) => {
      const k = await getKlines(s, timeframe, limit);
      if (k && k.length > 0) results[s] = k;
    }));
    if (i + batchSize < SYMBOLS_54.length) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}
async function getMultiTimeframeKlines(symbol, timeframes = ['4h', '15m', '1m']) {
  const results = {};
  for (const tf of timeframes) {
    const k = await getKlines(symbol, tf, TIMEFRAME_CONFIG[tf].limit);
    if (k) results[tf] = k;
  }
  return results;
}
async function getAllMultiTimeframeKlines(timeframes = ['4h', '15m', '1m']) {
  const results = {};
  for (const s of SYMBOLS_54) {
    const mtf = await getMultiTimeframeKlines(s, timeframes);
    if (Object.keys(mtf).length === timeframes.length) results[s] = mtf;
    await new Promise(r => setTimeout(r, 100));
  }
  return results;
}
async function getTickers() {
  try {
    const url = `${GATEIO_API_BASE}/spot/tickers`;
    const res = await axios.get(url, { timeout: 10000 });
    if (!res.data || !Array.isArray(res.data)) return null;
    const tickers = {};
    res.data.forEach(t => {
      const s = t.currency_pair;
      if (SYMBOLS_54.includes(s)) {
        tickers[s] = {
          symbol: s, last: parseFloat(t.last),
          high24h: parseFloat(t.high_24h), low24h: parseFloat(t.low_24h),
          volume24h: parseFloat(t.base_volume), change24h: parseFloat(t.change_percentage)
        };
      }
    });
    return tickers;
  } catch (e) {
    console.error('Error fetching tickers:', e.message);
    return null;
  }
}
module.exports = {
  SYMBOLS_54, TIMEFRAME_CONFIG, getKlines, getAllKlines,
  getMultiTimeframeKlines, getAllMultiTimeframeKlines, getTickers
};
