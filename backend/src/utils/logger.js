class MetricsCollector {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
  }
  increment(name, labels = {}, value = 1) {
    const key = JSON.stringify([name, labels]);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }
  set(name, value, labels = {}) {
    const key = JSON.stringify([name, labels]);
    this.gauges.set(key, value);
  }
  format() {
    let out = '';
    for (const [k, v] of this.counters) out += `${k} ${v}\n`;
    for (const [k, v] of this.gauges) out += `${k} ${v}\n`;
    return out;
  }
}
class Logger {
  constructor() {
    this.metrics = new MetricsCollector();
  }
  info(msg, meta = {}) {
    console.log(JSON.stringify({ t: new Date().toISOString(), l: 'INFO', m: msg, ...meta }));
  }
  error(msg, meta = {}) {
    console.error(JSON.stringify({ t: new Date().toISOString(), l: 'ERROR', m: msg, ...meta }));
  }
}
const logger = new Logger();
const metrics = logger.metrics;
module.exports = { logger, metrics };
