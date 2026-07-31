import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parsePublicUrl, resolveConfig, UsageError } from "../src/config.js";

describe("parsePublicUrl", () => {
  it("splits origin and basePath", () => {
    assert.deepEqual(parsePublicUrl("https://example.dev/thing"), {
      origin: "https://example.dev",
      basePath: "/thing",
      publicUrl: "https://example.dev/thing",
    });
  });

  it("normalises a trailing slash away", () => {
    // The unslashed form is what Next redirects *to*, so it is the baseline.
    assert.equal(parsePublicUrl("https://example.dev/thing/").publicUrl, "https://example.dev/thing");
  });

  it("keeps a nested path intact", () => {
    assert.equal(parsePublicUrl("https://example.dev/a/b").basePath, "/a/b");
  });

  it("rejects a bare origin, because this tool is about serving on a path", () => {
    assert.throws(() => parsePublicUrl("https://example.dev"), UsageError);
    assert.throws(() => parsePublicUrl("https://example.dev/"), UsageError);
  });

  it("rejects things that are not URLs", () => {
    assert.throws(() => parsePublicUrl("example.dev/thing"), UsageError);
    assert.throws(() => parsePublicUrl("ftp://example.dev/thing"), UsageError);
  });
});

describe("resolveConfig", () => {
  it("derives childOrigin from the subdomain", () => {
    const config = resolveConfig({
      url: "https://example.dev/thing",
      flags: { subdomain: "thing-app.example.dev" },
    });
    assert.equal(config.childOrigin, "https://thing-app.example.dev");
  });

  it("leaves intent null when neither flag nor file declares it", () => {
    const config = resolveConfig({ url: "https://example.dev/thing" });
    assert.equal(config.unlisted, null, "null means SKIP; false would mean 'indexed'");
  });

  it("lets flags win over annex.json", () => {
    const config = resolveConfig({
      flags: { subdomain: "flag.example.dev", indexed: true },
      file: { publicUrl: "https://example.dev/thing", subdomain: "file.example.dev", unlisted: true },
    });
    assert.equal(config.subdomain, "flag.example.dev");
    assert.equal(config.unlisted, false);
  });

  it("falls back to the file's publicUrl when no URL is given", () => {
    const config = resolveConfig({ file: { publicUrl: "https://example.dev/thing" } });
    assert.equal(config.publicUrl, "https://example.dev/thing");
  });

  it("explains itself when there is nothing to go on", () => {
    assert.throws(() => resolveConfig({}), (error) => {
      assert.ok(error instanceof UsageError);
      assert.match(error.message, /annex doctor https/);
      return true;
    });
  });
});
