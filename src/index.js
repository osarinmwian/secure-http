import { NativeModules, Platform } from 'react-native';
import MonitoringManager from './monitoring';
import { createSecureHttpClient } from './SecureHttpClient';

const { TLSSecurityModule } = NativeModules;

let tls13Initialized = false;

// Auto-initialize TLS 1.3 on module load
(async () => {
  if (!tls13Initialized && Platform.OS === 'android' && TLSSecurityModule) {
    try {
      await TLSSecurityModule.updateSecurityProvider();
      await TLSSecurityModule.forceTLS13();
      tls13Initialized = true;
    } catch (e) {
      console.warn('TLS 1.3 auto-initialization failed:', e?.message);
    }
  }
})();

export const isTLSModuleAvailable = () => {
  return Platform.OS === 'android' && TLSSecurityModule != null;
};

export const updateSecurityProvider = async () => {
  if (Platform.OS !== 'android') {
    return 'iOS does not require security provider updates';
  }
  
  if (!TLSSecurityModule) {
    throw new Error('TLS Security Module not available. Rebuild the app.');
  }
  
  try {
    const result = await TLSSecurityModule.updateSecurityProvider();
    return result;
  } catch (error) {
    throw new Error(`Failed to update security provider: ${error?.message}`);
  }
};

export const checkSecurityProviders = async () => {
  if (Platform.OS !== 'android') {
    return { topProvider: 'iOS', allProviders: ['iOS Security'] };
  }
  
  if (!TLSSecurityModule) {
    throw new Error('TLS Security Module not available');
  }
  
  try {
    const result = await TLSSecurityModule.checkSecurityProviders();
    return result;
  } catch (error) {
    throw new Error(`Failed to check providers: ${error.message}`);
  }
};

export const testTLS13Support = async () => {
  if (Platform.OS !== 'android') {
    return { conscryptInstalled: false, topProvider: 'iOS', tlsVersion: 'TLS 1.3' };
  }
  
  if (!TLSSecurityModule) {
    throw new Error('TLS Security Module not available');
  }
  
  try {
    const result = await TLSSecurityModule.testTLS13Support();
    return result;
  } catch (error) {
    throw new Error(`Failed to test TLS: ${error?.message}`);
  }
};

export const forceTLS13 = async () => {
  if (Platform.OS !== 'android') {
    return 'iOS uses TLS 1.3 by default';
  }
  
  if (!TLSSecurityModule) {
    throw new Error('TLS Security Module not available');
  }
  
  try {
    const result = await TLSSecurityModule.forceTLS13();
    return result;
  } catch (error) {
    throw new Error(`Failed to force TLS 1.3: ${error?.message}`);
  }
};

export const initializeTLS13Axios = async () => {
  if (!tls13Initialized) {
    try {
      await updateSecurityProvider();
      await forceTLS13();
      tls13Initialized = true;
    } catch (e) {
      console.error('Security Provider update failed, falling back to system default', e);
    }
  }
};

export const tls13Axios = createSecureHttpClient({
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add axios compatibility methods
tls13Axios.create = function(config = {}) {
  return createSecureHttpClient({
    timeout: 120000,
    headers: {
      'Content-Type': 'application/json',
    },
    ...config
  });
};

tls13Axios.isCancel = createSecureHttpClient.isCancel || ((error) => {
  return error && (error?.name === 'AbortError' || error?.message?.includes('abort'));
});

const originalRequest = tls13Axios.request.bind(tls13Axios);
tls13Axios.request = async function(config) {
  const monitor = MonitoringManager.getInstance();
  if (monitor) {
    config._requestStartTime = Date.now();
    config._requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    monitor.performance.startOperation(config._requestId);
  }
  
  try {
    const response = await originalRequest(config);
    if (monitor) {
      response.duration = Date.now() - config._requestStartTime;
      monitor.performance.endOperation(config._requestId, true, { status: response.status });
      monitor.performance.trackHttpRequest(config, response);
    }
    return response;
  } catch (error) {
    if (monitor) {
      error.duration = Date.now() - config._requestStartTime;
      monitor.performance.endOperation(config._requestId, false, { error: error?.message });
      const screenshot = monitor.captureScreenshotsOnError ? await monitor.screenshot.captureScreen() : null;
      monitor.performance.trackHttpRequest(config, error.response, error);
      monitor.telemetry.trackException(error, {
        url: config.url,
        method: config.method,
        status: error.response?.status,
        screenshot
      });
    }
    throw error;
  }
};

const createSecureHttpClientWithMonitoring = (config = {}) => {
  const client = createSecureHttpClient({
    timeout: 120000,
    ...config,
  });

  const monitor = MonitoringManager.getInstance();
  if (monitor) {
    const originalRequest = client.request.bind(client);
    client.request = async function(requestConfig) {
      requestConfig._requestStartTime = Date.now();
      requestConfig._requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      monitor.performance.startOperation(requestConfig._requestId);
      
      try {
        const response = await originalRequest(requestConfig);
        response.duration = Date.now() - requestConfig._requestStartTime;
        monitor.performance.endOperation(requestConfig._requestId, true, { status: response.status });
        monitor.performance.trackHttpRequest(requestConfig, response);
        return response;
      } catch (error) {
        error.duration = Date.now() - requestConfig._requestStartTime;
        monitor.performance.endOperation(requestConfig._requestId, false, { error: error?.message });
        const screenshot = monitor.captureScreenshotsOnError ? await monitor.screenshot.captureScreen() : null;
        monitor.performance.trackHttpRequest(requestConfig, error.response, error);
        monitor.telemetry.trackException(error, {
          url: requestConfig.url,
          method: requestConfig.method,
          status: error.response?.status,
          screenshot
        });
        throw error;
      }
    };
  }

  return client;
};

export const initializeMonitoring = (config) => {
  return MonitoringManager.initialize(config);
};

export const getMonitoring = () => {
  return MonitoringManager.getInstance();
};

export default createSecureHttpClientWithMonitoring;
export { createSecureHttpClientWithMonitoring as createSecureHttpClient, MonitoringManager };
