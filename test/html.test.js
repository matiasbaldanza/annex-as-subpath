import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalHref,
  robotsMeta,
  rootAbsoluteOffenders,
  unprefixedNextRefs,
  vercelAppHosts,
} from "../src/html.js";
import { broken, GOOD_HTML } from "./helpers.js";

describe("unprefixedNextRefs", () => {
  it("finds none in a correctly configured app", () => {
    const { total, unprefixed } = unprefixedNextRefs(GOOD_HTML, "/basement");
    assert.ok(total > 0, "the real capture should contain /_next/ references");
    assert.equal(unprefixed, 0);
  });

  it("catches a missing basePath", () => {
    // What the served HTML looks like when basePath is absent: every asset
    // path drops the prefix, the HTML still arrives, and the page renders
    // blank behind the proxy.
    const html = broken(GOOD_HTML, "/basement/_next/", "/_next/");
    const { unprefixed } = unprefixedNextRefs(html, "/basement");
    assert.ok(unprefixed > 0);
  });

  it("sees through escaped slashes in inlined JSON", () => {
    const html = '<script>self.__next_f.push([1,"\\u002f_next\\u002fstatic"])</script>';
    // Not our escaping form, but the backslash-slash form Next also emits:
    const escaped = '<script>self.__next_f.push([1,"\\/_next\\/static/x.js"])</script>';
    assert.equal(unprefixedNextRefs(escaped, "/basement").unprefixed, 1);
    assert.equal(unprefixedNextRefs(html, "/basement").total, 0);
  });
});

describe("rootAbsoluteOffenders", () => {
  it("accepts paths under the basePath", () => {
    const html = '<img src="/basement/logo.svg"><link href="/basement/style.css">';
    assert.deepEqual(rootAbsoluteOffenders(html, "/basement"), []);
  });

  it("flags a public/ file referenced without the prefix", () => {
    // The exact bug the assetPath() helper exists to prevent: works locally,
    // 404s in production because basePath does not prefix public/.
    const offenders = rootAbsoluteOffenders('<img src="/logo.svg">', "/basement");
    assert.deepEqual(offenders, [{ attr: "src", value: "/logo.svg" }]);
  });

  it("ignores absolute and protocol-relative URLs", () => {
    const html = '<link href="https://fonts.example/x.css"><img src="//cdn.example/y.png">';
    assert.deepEqual(rootAbsoluteOffenders(html, "/basement"), []);
  });

  it("ignores commented-out markup", () => {
    assert.deepEqual(rootAbsoluteOffenders('<!-- <img src="/logo.svg"> -->', "/basement"), []);
  });

  it("does not mistake the basePath prefix for a longer sibling path", () => {
    // "/basementry/x" starts with "/basement" but is not under it.
    const offenders = rootAbsoluteOffenders('<img src="/basementry/x.png">', "/basement");
    assert.deepEqual(offenders, [{ attr: "src", value: "/basementry/x.png" }]);
  });
});

describe("canonicalHref", () => {
  it("reads the absolute canonical from the real capture", () => {
    assert.equal(canonicalHref(GOOD_HTML), "https://matiasbaldanza.dev/basement");
  });

  it("returns null when there is none", () => {
    assert.equal(canonicalHref("<html><head></head></html>"), null);
  });

  it("is not fooled by another link tag appearing first", () => {
    const html = '<link rel="icon" href="/favicon.ico"><link rel="canonical" href="https://x/y">';
    assert.equal(canonicalHref(html), "https://x/y");
  });
});

describe("robotsMeta", () => {
  it("reads noindex from the real capture", () => {
    assert.equal(robotsMeta(GOOD_HTML), "noindex, nofollow");
  });

  it("returns null when absent", () => {
    const html = broken(GOOD_HTML, '<meta name="robots" content="noindex, nofollow"/>', "");
    assert.equal(robotsMeta(html), null);
  });

  it("ignores other meta tags", () => {
    assert.equal(robotsMeta('<meta name="description" content="noindex">'), null);
  });
});

describe("vercelAppHosts", () => {
  it("finds none in the real capture", () => {
    assert.deepEqual(vercelAppHosts(GOOD_HTML), []);
  });

  it("catches a leaked deployment host", () => {
    const html = '<a href="https://basement-abc123.vercel.app/basement">x</a>';
    assert.deepEqual(vercelAppHosts(html), ["basement-abc123.vercel.app"]);
  });

  it("deduplicates", () => {
    const html = "a.vercel.app and a.vercel.app and B.VERCEL.APP";
    assert.deepEqual(vercelAppHosts(html), ["a.vercel.app", "b.vercel.app"]);
  });
});
