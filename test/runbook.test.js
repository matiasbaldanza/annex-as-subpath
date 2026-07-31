import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveConfig } from "../src/config.js";
import { renderRunbook, slug } from "../src/runbook.js";

/** A runbook for a domain that shares nothing with the reference project. */
function render(flags = {}) {
  const config = resolveConfig({ url: "https://acme.test/portal", flags });
  return renderRunbook({ ...config, subdomain: config.subdomain ?? config.suggestedSubdomain });
}

describe("slug", () => {
  it("strips the leading slash", () => {
    assert.equal(slug("/thing"), "thing");
  });

  it("flattens a nested path into a legal hostname label", () => {
    assert.equal(slug("/a/b"), "a-b");
  });
});

describe("the generated runbook", () => {
  const markdown = render();

  it("never leaks a value from the project it was written from", () => {
    // The whole premise is "not a generic template the human has to
    // translate". A stray matiasbaldanza.dev or /basement means a section was
    // written with a hardcoded value instead of the config.
    for (const leak of ["matiasbaldanza", "/basement", "basement-jobapp"]) {
      assert.ok(!markdown.includes(leak), `Runbook leaked ${leak} from the reference project`);
    }
  });

  it("does not ship a real account-specific CNAME target as the example", () => {
    // The illustrative target is invented on purpose. A real one published in
    // every generated runbook is somebody's infrastructure, and a reader who
    // recognises it as real is likelier to paste it.
    assert.ok(!markdown.includes("41f6e7a1e2e4f755"));
    assert.match(markdown, /that one is invented, yours will not\nmatch it/);
  });

  it("never leaks the example.dev placeholders from --help", () => {
    for (const leak of ["example.dev", "thing-app", "<your", "YOUR_"]) {
      assert.ok(!markdown.includes(leak), `Runbook contains unsubstituted placeholder ${leak}`);
    }
  });

  it("substitutes the real domain, path, and derived subdomain", () => {
    assert.match(markdown, /https:\/\/acme\.test\/portal/);
    assert.match(markdown, /portal-app\.acme\.test/);
    assert.match(markdown, /basePath: BASE_PATH/);
    assert.match(markdown, /BASE_PATH = "\/portal"/);
  });

  it("uses the DNS record name, not the full hostname, in the record table", () => {
    // Pasting "portal-app.acme.test" into Cloudflare's Name field creates
    // portal-app.acme.test.acme.test. The table must say `portal-app`.
    assert.match(markdown, /\| Name \| `portal-app` \|/);
  });

  it("says the CNAME target must be copied off the screen", () => {
    assert.match(markdown, /account-specific/);
    assert.match(markdown, /Copy that value off this screen/);
  });

  it("gives exact navigation paths, not verbs", () => {
    assert.match(markdown, /Settings → Deployment Protection → Vercel\n?Authentication/);
    assert.match(markdown, /Settings → Domains → Add/);
  });

  it("puts Deployment Protection before any verification", () => {
    assert.ok(
      markdown.indexOf("Turn off Deployment Protection") < markdown.indexOf("Verify DNS and TLS"),
      "protection must come first, or every later check fails for the wrong reason",
    );
  });

  it("verifies the child standalone before the apex is touched", () => {
    assert.ok(
      markdown.indexOf("verify it standalone") < markdown.indexOf("Add the rewrites to the apex"),
    );
  });

  it("states an expected output for every verification command", () => {
    const commands = markdown.match(/```bash\n[\s\S]*?```/g) ?? [];
    assert.ok(commands.length >= 5, "expected several verification commands");
    // Every bash block should be followed within a few lines by what to expect.
    for (const block of commands) {
      const after = markdown.slice(markdown.indexOf(block) + block.length, markdown.indexOf(block) + block.length + 400);
      assert.match(after, /Expected|expected|means|`cf-ray`/, `No expected output after:\n${block}`);
    }
  });

  it("emits both rewrite rules, because the wildcard alone 404s the bare path", () => {
    assert.match(markdown, /"source": "\/portal"/);
    assert.match(markdown, /"source": "\/portal\/:path\*"/);
  });

  it("closes every code fence", () => {
    const fences = (markdown.match(/```/g) ?? []).length;
    assert.equal(fences % 2, 0, "unbalanced code fences");
  });
});

describe("runbook options", () => {
  it("honours an explicit subdomain over the derived one", () => {
    const markdown = render({ subdomain: "annex.acme.test" });
    assert.match(markdown, /annex\.acme\.test/);
    assert.ok(!markdown.includes("portal-app"));
    assert.match(markdown, /\| Name \| `annex` \|/);
  });

  it("includes the robots block only when the page is unlisted", () => {
    assert.match(render({ unlisted: true }), /robots: \{ index: false, follow: false \}/);
    assert.ok(!render({ indexed: true }).includes("robots: { index: false"));
  });

  it("passes the declared intent through to the doctor command it suggests", () => {
    assert.match(render({ unlisted: true }), /doctor https:\/\/acme\.test\/portal .*--unlisted/);
    assert.match(render({ indexed: true }), /doctor https:\/\/acme\.test\/portal .*--indexed/);
  });

  it("drops the way-back section when it is not wanted", () => {
    const markdown = render({ "no-way-back": true });
    assert.ok(!markdown.includes("unlisted-entry"));
    assert.ok(!markdown.includes("The way back"));
    // …and the troubleshooting table should not reference a step that is gone.
    assert.ok(!markdown.includes("Way-back link never appears"));
  });

  it("uses the custom label inside the way-back contract", () => {
    assert.match(render({ label: "the portal pitch" }), /"label": "the portal pitch"/);
  });
});
