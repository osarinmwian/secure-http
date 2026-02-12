import { Platform } from "react-native";
import CryptoUtils from "./CryptoUtils";

const hasFetch = typeof fetch !== "undefined";

class SecureHttpClient {
  constructor(config = {}) {
    this.baseURL = config.baseURL || "";
    this.headers = config.headers || {};
    this.timeout = config.timeout || 30000;
    this.cryptoKey = config.cryptoKey || null;
    this.enableCrypto = config.enableCrypto || false;
    this.interceptors = {
      request: [],
      response: [],
      error: [],
    };
  }

  create(config = {}) {
    return new SecureHttpClient({
      ...config,
      baseURL: config.baseURL || this.baseURL,
      headers: { ...this.headers, ...config.headers },
      timeout: config.timeout || this.timeout,
      cryptoKey: config.cryptoKey || this.cryptoKey,
      enableCrypto: config.enableCrypto !== undefined ? config.enableCrypto : this.enableCrypto,
    });
  }

  static isCancel(error) {
    return error && (error.name === "AbortError" || error.message?.includes("abort"));
  }

  async request(config) {
    if (!config) {
      throw new Error("Request config is required");
    }

    const url = this._buildURL(config.url);
    const headers = { ...this.headers, ...config.headers };
    const method = (config.method || "GET").toUpperCase();

    let requestConfig = { ...config, url, headers, method };

    // Apply crypto security if enabled
    if (this.enableCrypto && this.cryptoKey && config.data) {
      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = CryptoUtils.generateNonce();
      const encrypted = await CryptoUtils.encrypt(JSON.stringify(config.data), this.cryptoKey);
      const signature = await CryptoUtils.sign(encrypted, timestamp, this.cryptoKey);
      
      requestConfig.data = { data: encrypted, timestamp, signature, nonce };
    }

    // Run request interceptors
    for (const interceptor of this.interceptors.request) {
      try {
        requestConfig = await interceptor(requestConfig);
        if (!requestConfig) {
          throw new Error("Request interceptor returned undefined config");
        }
      } catch (error) {
        console.error("Request interceptor error:", error);
        throw error;
      }
    }

    try {
      const result = hasFetch ? await this._fetchRequest(requestConfig) : await this._xhrRequest(requestConfig);
      
      // Decrypt response if crypto enabled
      if (this.enableCrypto && this.cryptoKey && result.data?.data) {
        const decrypted = await CryptoUtils.decrypt(result.data.data, this.cryptoKey);
        result.data = JSON.parse(decrypted);
      }
      
      return result;
    } catch (error) {
      throw error.response ? error : { message: error.message, config: requestConfig };
    }
  }

  async _fetchRequest(requestConfig) {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), this.timeout)
      : null;

    const response = await fetch(requestConfig.url, {
      method: requestConfig.method,
      headers: requestConfig.headers,
      body: requestConfig.data ? JSON.stringify(requestConfig.data) : undefined,
      signal: controller ? controller.signal : undefined,
    });

    if (timeoutId) clearTimeout(timeoutId);

    let data = await response.text();
    try {
      data = JSON.parse(data);
    } catch {}

    let result = {
      data,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      config: requestConfig,
    };

    // Run response interceptors
    for (const interceptor of this.interceptors.response) {
      result = await interceptor(result);
    }

    if (!response.ok) {
      const error = {
        response: result,
        message: `Request failed with status ${response.status}`,
        config: requestConfig,
      };

      // Run error interceptors
      for (const interceptor of this.interceptors.error || []) {
        await interceptor(error);
      }

      throw error;
    }

    return result;
  }

  async _xhrRequest(requestConfig) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      const timeoutId = setTimeout(() => {
        xhr.abort();
        reject({ message: "Request timeout", config: requestConfig });
      }, this.timeout);

      xhr.onload = async () => {
        clearTimeout(timeoutId);

        let data = xhr.responseText;
        try {
          data = JSON.parse(data);
        } catch {}

        let result = {
          data,
          status: xhr.status,
          statusText: xhr.statusText,
          headers: this._parseHeaders(xhr.getAllResponseHeaders()),
          config: requestConfig,
        };

        // Run response interceptors
        for (const interceptor of this.interceptors.response) {
          result = await interceptor(result);
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(result);
        } else {
          const error = {
            response: result,
            message: `Request failed with status ${xhr.status}`,
            config: requestConfig,
          };

          // Run error interceptors
          (async () => {
            for (const interceptor of this.interceptors.error || []) {
              await interceptor(error);
            }
            reject(error);
          })();
        }
      };

      xhr.onerror = () => {
        clearTimeout(timeoutId);
        reject({ message: "Network error", config: requestConfig });
      };

      xhr.open(requestConfig.method, requestConfig.url);

      Object.keys(requestConfig.headers).forEach((key) => {
        xhr.setRequestHeader(key, requestConfig.headers[key]);
      });

      xhr.send(
        requestConfig.data ? JSON.stringify(requestConfig.data) : undefined,
      );
    });
  }

  _parseHeaders(headerString) {
    const headers = {};
    if (!headerString) return headers;

    headerString.split("\r\n").forEach((line) => {
      const parts = line.split(": ");
      if (parts.length === 2) {
        headers[parts[0]] = parts[1];
      }
    });

    return headers;
  }

  get(url, config = {}) {
    return this.request({ ...config, url, method: "GET" });
  }

  post(url, data, config = {}) {
    return this.request({ ...config, url, method: "POST", data });
  }

  put(url, data, config = {}) {
    return this.request({ ...config, url, method: "PUT", data });
  }

  delete(url, config = {}) {
    return this.request({ ...config, url, method: "DELETE" });
  }

  patch(url, data, config = {}) {
    return this.request({ ...config, url, method: "PATCH", data });
  }

  _buildURL(url) {
    if (url.startsWith("http")) return url;
    return this.baseURL + url;
  }
}

export function createSecureHttpClient(config) {
  const client = new SecureHttpClient(config);

  // Add isCancel as a static method on the instance for axios compatibility
  client.isCancel = SecureHttpClient.isCancel;

  return client;
}

// Export isCancel as a standalone function for axios compatibility
export const isCancel = SecureHttpClient.isCancel;

export default createSecureHttpClient;
