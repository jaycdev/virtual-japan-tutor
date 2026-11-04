/**
 * In-memory stand-in for expo-secure-store (test only). The real module is
 * native Turbo-Module code jsdom cannot load.
 */
const store = new Map();

module.exports = {
  getItemSync: (key) => (store.has(key) ? store.get(key) : null),
  setItemSync: (key, value) => {
    store.set(key, value);
  },
  deleteItemSync: (key) => {
    store.delete(key);
  },
  getItem: async (key) => (store.has(key) ? store.get(key) : null),
  setItem: async (key, value) => {
    store.set(key, value);
  },
  deleteItem: async (key) => {
    store.delete(key);
  },
  getItemAsync: async (key) => (store.has(key) ? store.get(key) : null),
  setItemAsync: async (key, value) => {
    store.set(key, value);
  },
  deleteItemAsync: async (key) => {
    store.delete(key);
  },
  clearAll: () => store.clear(),
};
