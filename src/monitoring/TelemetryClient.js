import { Platform } from 'react-native';

class TelemetryClient {
  constructor(config = {}) {
    this.instrumentationKey = config.instrumentationKey;
    this.enabled = config.enabled !== false;
    this.context = {
      application: { version: config.appVersion || '1.0.0' },
      device: { type: Platform.OS, osVersion: Platform.Version },
      session: { id: this._generateSessionId() },
      user: { id: config.userId || 'anonymous' }
    };
    this.buffer = [];
    this.maxBufferSize = config.maxBufferSize || 100;
    this.flushInterval = config.flushInterval || 30000;
    this.endpoint = config.endpoint;
    this._startAutoFlush();
  }

  trackEvent(name, properties = {}, measurements = {}) {
    this._track('Event', { name, properties, measurements });
  }

  trackMetric(name, value, properties = {}) {
    this._track('Metric', { name, value, properties });
  }

  trackException(error, properties = {}) {
    this._track('Exception', {
      message: error?.message,
      stack: error?.stack,
      type: error?.name,
      properties
    });
  }

  trackRequest(name, url, duration, responseCode, success, properties = {}) {
    this._track('Request', { name, url, duration, responseCode, success, properties });
  }

  trackDependency(name, type, target, duration, success, resultCode, properties = {}) {
    this._track('Dependency', { name, type, target, duration, success, resultCode, properties });
  }

  trackTrace(message, severity = 'Information', properties = {}) {
    this._track('Trace', { message, severity, properties });
  }

  _track(type, data) {
    if (!this.enabled) return;
    
    this.buffer?.push({
      type,
      timestamp: new Date().toISOString(),
      context: this.context,
      data
    });

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  async flush() {
    if (this.buffer.length === 0 || !this.endpoint) return;

    const items = [...this.buffer];
    this.buffer = [];

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
    } catch (error) {
      console.warn('Telemetry flush failed:', error?.message);
    }
  }

  _startAutoFlush() {
    this.flushTimer = setInterval(() => this.flush(), this.flushInterval);
  }

  dispose() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flush();
  }

  _generateSessionId() {
    return `${Date.now()}-${Math.random()?.toString(36)?.slice(2, 11)}`;
  }
}

export default TelemetryClient;
