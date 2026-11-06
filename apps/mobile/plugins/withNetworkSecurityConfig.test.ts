import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// The plugin is plain CommonJS, like withReleaseSigning.js.
const require = createRequire(import.meta.url);
const plugin = require("./withNetworkSecurityConfig.js") as {
  networkSecurityConfigXml: () => string;
  setNetworkSecurityConfig: (application: { $?: Record<string, string> }) => { $?: Record<string, string> };
};

describe("networkSecurityConfigXml", () => {
  it("trusts the system CAs and the CAs the user installs", () => {
    const xml = plugin.networkSecurityConfigXml();
    expect(xml).toContain('<certificates src="system" />');
    expect(xml).toContain('<certificates src="user" />');
  });

  it("keeps cleartext (plain http) blocked", () => {
    expect(plugin.networkSecurityConfigXml()).toContain('cleartextTrafficPermitted="false"');
  });
});

describe("setNetworkSecurityConfig", () => {
  it("points the application at the generated resource", () => {
    const application = plugin.setNetworkSecurityConfig({ $: { "android:label": "VJT" } });
    expect(application.$).toEqual({
      "android:label": "VJT",
      "android:networkSecurityConfig": "@xml/network_security_config",
    });
  });

  it("creates the attributes when the application element has none", () => {
    const application = plugin.setNetworkSecurityConfig({});
    expect(application.$?.["android:networkSecurityConfig"]).toBe("@xml/network_security_config");
  });
});
