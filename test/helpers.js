import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const GOOD_HTML = readFileSync(
  fileURLToPath(new URL("./fixtures/good.html", import.meta.url)),
  "utf8",
);

/**
 * Derive a broken variant from the real capture.
 *
 * Asserts that the replacement actually applied. Without that assertion a
 * fixture that stops matching after a refresh would silently become a copy of
 * the *good* document, and every "detects the bug" test would pass by testing
 * nothing.
 */
export function broken(html, find, replace) {
  assert.ok(html.includes(find), `Fixture no longer contains ${JSON.stringify(find)} — refresh it`);
  return html.replaceAll(find, replace);
}

export const CONFIG = {
  origin: "https://matiasbaldanza.dev",
  basePath: "/basement",
  publicUrl: "https://matiasbaldanza.dev/basement",
  subdomain: "basement-jobapp.matiasbaldanza.dev",
  childOrigin: "https://basement-jobapp.matiasbaldanza.dev",
  unlisted: true,
  timeout: 10_000,
};

/** A bundle where everything is healthy; spread over it to break one thing. */
export function healthyBundle(overrides = {}) {
  return {
    config: CONFIG,
    main: {
      requestedUrl: CONFIG.publicUrl,
      finalUrl: CONFIG.publicUrl,
      status: 200,
      headers: {},
      chain: [],
      body: GOOD_HTML,
    },
    slashed: {
      requestedUrl: `${CONFIG.publicUrl}/`,
      finalUrl: CONFIG.publicUrl,
      status: 200,
      headers: {},
      chain: [
        {
          url: `${CONFIG.publicUrl}/`,
          status: 308,
          location: "/basement",
          locationIsRelative: true,
          resolved: CONFIG.publicUrl,
        },
      ],
      body: GOOD_HTML,
    },
    loop: { requestedUrl: `${CONFIG.publicUrl}/_annex-doctor-loop-probe`, status: 404, headers: {} },
    originRoot: {
      requestedUrl: `${CONFIG.origin}/`,
      finalUrl: `${CONFIG.origin}/`,
      status: 200,
      headers: {},
      chain: [],
      body: "<html></html>",
    },
    robotsTxt: { status: 200, headers: {}, chain: [], body: "User-agent: *\nAllow: /\n" },
    childRoot: {
      requestedUrl: `${CONFIG.childOrigin}/`,
      status: 307,
      headers: {},
      location: CONFIG.publicUrl,
      resolved: CONFIG.publicUrl,
    },
    subdomain: {
      finalUrl: `${CONFIG.childOrigin}${CONFIG.basePath}`,
      status: 200,
      headers: { "x-vercel-id": "gru1::abc" },
      chain: [],
      body: GOOD_HTML,
    },
    cname: { records: ["41f6e7a1e2e4f755.vercel-dns-017.com"] },
    canonicalProbe: { requestedUrl: CONFIG.publicUrl, status: 200, headers: {}, location: null },
    assetProbes: [],
    ...overrides,
  };
}

/** The verdict for one check id, from a bundle. */
export function verdict(results, id) {
  const found = results.find((result) => result.id === id);
  assert.ok(found, `No check with id ${id}`);
  return found;
}
