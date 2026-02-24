class AppError extends Error {
  constructor(msg, code, status = 500) {
    super(msg);
    this.code = code;
    this.statusCode = status;
  }
}
class ValidationError extends AppError {
  constructor(msg, field) {
    super(msg, 'VALIDATION_ERROR', 400);
    this.field = field;
  }
}
class RateLimitError extends AppError {
  constructor(msg) {
    super(msg, 'RATE_LIMIT_EXCEEDED', 429);
  }
}
class TimeoutError extends AppError {
  constructor(msg = 'Timeout') {
    super(msg, 'TIMEOUT_ERROR', 504);
  }
}
class InputValidator {
  static validateSymbol(s) {
    if (!s) throw new ValidationError('Symbol required', 'symbol');
    if (typeof s !== 'string') throw new ValidationError('Symbol must be string', 'symbol');
  }
  static validateKlines(k) {
    if (!Array.isArray(k)) throw new ValidationError('Klines must be array', 'klines');
    if (k.length < 10) throw new ValidationError('Insufficient klines', 'klines');
  }
}
async function withRetry(fn, opts = {}) {
  const { maxRetries = 3, retryDelay = 1000, timeout = 30000 } = opts;
  for (let i = 1; i <= maxRetries; i++) {
    try {
      return await Promise.race([fn(), new Promise((_, r) => setTimeout(() => r(new TimeoutError()), timeout))]);
    } catch (e) {
      if (i >= maxRetries) throw e;
      await new Promise(r => setTimeout(r, retryDelay * Math.pow(2, i - 1)));
    }
  }
}
class RateLimiter {
  constructor(opts = {}) {
    this.windowMs = opts.windowMs || 60 * 60 * 1000;
    this.maxRequests = opts.maxRequests || 10;
    this.requests = new Map();
  }
  check(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    for (const [k, ts] of this.requests) {
      const f = ts.filter(t => t > windowStart);
      if (f.length === 0) this.requests.delete(k);
      else this.requests.set(k, f);
    }
    const ts = this.requests.get(key) || [];
    if (ts.length >= this.maxRequests) return false;
    ts.push(now);
    this.requests.set(key, ts);
    return true;
  }
}
module.exports = {
  AppError, ValidationError, RateLimitError, TimeoutError,
  InputValidator, withRetry, RateLimiter
};
