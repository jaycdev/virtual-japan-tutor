// Node-side stand-in for expo-linking (see vitest.setup.ts). The jsdom harness
// is a plain web page: URLs are absolute pathnames on localhost, deep links
// arrive through window.history (which the router also watches).
const CURRENT_URL = () =>
  typeof window !== "undefined" && window.location ? window.location.href : "http://localhost/";

module.exports = {
  createURL: (path) => (path.startsWith("http") ? path : `http://localhost${path.startsWith("/") ? path : `/${path}`}`),
  getLinkingURL: CURRENT_URL,
  // The real API resolves asynchronously; sync value is fine for the harness.
  getLinkingURLAsync: async () => CURRENT_URL(),
  openURL: async () => true,
  canOpenURL: async () => true,
  getGeneralSettings: async () => ({ isDarkMode: false, prefersCrossAppDeepLinks: false }),
  getSystemFeatures: () => [],
  addEventListener: () => ({ remove: () => undefined }),
  sendAppOpenEvent: () => undefined,
  // Dev-mode launch URL unwrapping: no dev launcher here, URLs are literal.
  unwrapDevLaunchURL: (url) => url,
  getDevLaunchUrlPrefix: () => /^about:blank$/,
  Linking: {
    addEventListener: () => ({ remove: () => undefined }),
    openURL: async () => true,
    canOpenURL: async () => true,
    getInitialURL: async () => null,
    getConstants: () => ({}) ,
  },
};
