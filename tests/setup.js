// Global Chrome Extension API mock for Jest
global.chrome = {
  storage: {
    local: {
      _store: {},
      get(keys, callback) {
        const result = {};
        const keyArray = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys));
        keyArray.forEach(k => {
          if (this._store[k] !== undefined) result[k] = this._store[k];
        });
        if (callback) callback(result);
        return Promise.resolve(result);
      },
      set(obj, callback) {
        Object.assign(this._store, obj);
        if (callback) callback();
        return Promise.resolve();
      },
      clear() {
        this._store = {};
        return Promise.resolve();
      },
    },
  },
  runtime: {
    onMessage: { addListener: jest.fn() },
    sendMessage: jest.fn(),
    lastError: null,
    getURL: (path) => `chrome-extension://test-id/${path}`,
  },
  tabs: {
    query: jest.fn(),
    sendMessage: jest.fn(),
    create: jest.fn(),
  },
};

// Reset storage before each test
beforeEach(() => {
  chrome.storage.local._store = {};
  chrome.runtime.lastError = null;
});
