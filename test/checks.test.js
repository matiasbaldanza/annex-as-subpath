import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FAIL, PASS, SKIP, WARN } from "../src/checks.js";
import { runChecks } from "../src/doctor.js";
import { broken, CONFIG, GOOD_HTML, healthyBundle, verdict } from "./helpers.js";

/** Every non-pass must say what to do. This is the tool's whole premise. */
function assertHasRemediation(result) {
  assert.ok(
    result.remediation && result.remediation.length > 20,
    `Check "${result.id}" returned ${result.status} with no usable remediation`,
  );
}

describe("a healthy deployment", () => {
  const results = runChecks(healthyBundle());

  it("passes everything", () => {
    const notPassing = results.filter((result) => result.status !== PASS);
    assert.deepEqual(
      notPassing.map((result) => `${result.id}: ${result.status} — ${result.detail}`),
      [],
    );
  });
});

describe("every failing check explains the fix", () => {
  // Deliberately broad: it is easy to add a check later and forget the
  // remediation, and a symptom without a fix is the thing this tool replaced.
  const bundles = {
    "missing basePath": healthyBundle({
      main: {
        ...healthyBundle().main,
        body: broken(GOOD_HTML, "/basement/_next/", "/_next/"),
      },
    }),
    "sso login page": healthyBundle({
      main: { ...healthyBundle().main, status: 401, body: "" },
    }),
    "proxied subdomain": healthyBundle({
      subdomain: { ...healthyBundle().subdomain, headers: { "cf-ray": "8a1b2c3d" } },
    }),
    "redirect loop": healthyBundle({
      loop: { requestedUrl: `${CONFIG.publicUrl}/x`, status: 308, resolved: CONFIG.publicUrl },
    }),
    "no cname": healthyBundle({ cname: { records: [], error: "ENOTFOUND" } }),
    "relative canonical": healthyBundle({
      main: {
        ...healthyBundle().main,
        body: broken(GOOD_HTML, 'href="https://matiasbaldanza.dev/basement"', 'href="/"'),
      },
    }),
  };

  for (const [name, bundle] of Object.entries(bundles)) {
    it(name, () => {
      const results = runChecks(bundle);
      const failing = results.filter((r) => r.status === FAIL || r.status === WARN);
      assert.ok(failing.length > 0, `${name} should produce at least one non-pass`);
      for (const result of failing) assertHasRemediation(result);
    });
  }
});

describe("next-assets-under-basepath", () => {
  it("fails when basePath is missing, and names the config key", () => {
    const bundle = healthyBundle({
      main: { ...healthyBundle().main, body: broken(GOOD_HTML, "/basement/_next/", "/_next/") },
    });
    const result = verdict(runChecks(bundle), "next-assets-under-basepath");
    assert.equal(result.status, FAIL);
    assert.match(result.remediation, /basePath: "\/basement"/);
  });

  it("warns rather than passes when there are no _next references at all", () => {
    const bundle = healthyBundle({
      main: { ...healthyBundle().main, body: "<html><body>hi</body></html>" },
    });
    assert.equal(verdict(runChecks(bundle), "next-assets-under-basepath").status, WARN);
  });
});

describe("public-url-200", () => {
  it("identifies a 401 as Deployment Protection, not a generic failure", () => {
    const bundle = healthyBundle({ main: { ...healthyBundle().main, status: 401, body: "" } });
    const result = verdict(runChecks(bundle), "public-url-200");
    assert.equal(result.status, FAIL);
    assert.match(result.remediation, /Deployment Protection/);
    assert.match(result.remediation, /Require Log In/);
  });

  it("fails on any redirect at the canonical URL", () => {
    const bundle = healthyBundle({
      main: {
        ...healthyBundle().main,
        finalUrl: "https://www.matiasbaldanza.dev/basement",
        chain: [
          {
            url: CONFIG.publicUrl,
            status: 307,
            location: "https://www.matiasbaldanza.dev/basement",
            locationIsRelative: false,
            resolved: "https://www.matiasbaldanza.dev/basement",
          },
        ],
      },
    });
    assert.equal(verdict(runChecks(bundle), "public-url-200").status, FAIL);
  });
});

describe("root-absolute-assets", () => {
  it("passes when the apex happens to serve the offending path", () => {
    const bundle = healthyBundle({
      main: { ...healthyBundle().main, body: '<img src="/favicon.ico">' },
      assetProbes: [{ value: "/favicon.ico", status: 200 }],
    });
    assert.equal(verdict(runChecks(bundle), "root-absolute-assets").status, PASS);
  });

  it("fails when it 404s, and points at the assetPath helper", () => {
    const bundle = healthyBundle({
      main: { ...healthyBundle().main, body: '<img src="/logo.svg">' },
      assetProbes: [{ value: "/logo.svg", status: 404 }],
    });
    const result = verdict(runChecks(bundle), "root-absolute-assets");
    assert.equal(result.status, FAIL);
    assert.match(result.remediation, /assetPath\("\/logo\.svg"\)/);
  });
});

describe("robots", () => {
  it("skips, never passes, when intent was not declared", () => {
    const bundle = healthyBundle({ config: { ...CONFIG, unlisted: null } });
    assert.equal(verdict(runChecks(bundle), "robots-meta").status, SKIP);
  });

  it("fails an unlisted page with no noindex", () => {
    const bundle = healthyBundle({
      main: {
        ...healthyBundle().main,
        body: broken(GOOD_HTML, '<meta name="robots" content="noindex, nofollow"/>', ""),
      },
    });
    assert.equal(verdict(runChecks(bundle), "robots-meta").status, FAIL);
  });

  it("fails an indexed page that carries noindex", () => {
    const bundle = healthyBundle({ config: { ...CONFIG, unlisted: false } });
    assert.equal(verdict(runChecks(bundle), "robots-meta").status, FAIL);
  });

  it("flags a robots.txt that advertises the unlisted path", () => {
    const bundle = healthyBundle({
      robotsTxt: { status: 200, body: "User-agent: *\nDisallow: /basement\n" },
    });
    const result = verdict(runChecks(bundle), "robots-txt-permissive");
    assert.equal(result.status, FAIL);
    assert.match(result.remediation, /advertises it/);
  });
});

describe("skips when evidence is missing", () => {
  const bundle = healthyBundle({
    config: { ...CONFIG, subdomain: null, childOrigin: null, unlisted: null },
    subdomain: null,
    childRoot: null,
    cname: null,
  });
  const results = runChecks(bundle);

  it("never reports a check it could not run as passing", () => {
    for (const id of ["dns-cname", "subdomain-not-proxied", "child-root-redirect", "robots-meta"]) {
      assert.equal(verdict(results, id).status, SKIP, `${id} should skip, not pass`);
    }
  });

  it("tells the human how to un-skip the DNS checks", () => {
    assert.match(verdict(results, "dns-cname").remediation, /--subdomain/);
  });
});

describe("an apex that canonicalises to www", () => {
  // Regression for a real result against matiasbaldanza.dev/basement, which
  // 307s to www. Four checks failed and three of them printed a confident,
  // wrong diagnosis — blaming redirect rules in next.config.ts that did not
  // exist. One root cause must not produce four different wrong fixes.
  const wwwHost = "https://www.matiasbaldanza.dev";
  const viaWww = (path) => `${wwwHost}${path}`;

  const bundle = healthyBundle({
    originRoot: {
      requestedUrl: `${CONFIG.origin}/`,
      finalUrl: `${wwwHost}/`,
      status: 200,
      headers: {},
      chain: [{ url: `${CONFIG.origin}/`, status: 307, location: `${wwwHost}/`, resolved: `${wwwHost}/` }],
      body: "<html></html>",
    },
    main: {
      ...healthyBundle().main,
      finalUrl: viaWww("/basement"),
      chain: [
        {
          url: CONFIG.publicUrl,
          status: 307,
          location: viaWww("/basement"),
          locationIsRelative: false,
          resolved: viaWww("/basement"),
        },
      ],
    },
    loop: { requestedUrl: `${CONFIG.publicUrl}/x`, status: 307, resolved: viaWww("/basement/x") },
    slashed: { ...healthyBundle().slashed, finalUrl: viaWww("/basement") },
  });

  const results = runChecks(bundle);

  it("names the root cause once", () => {
    const root = verdict(results, "origin-canonical-host");
    assert.equal(root.status, FAIL);
    assert.match(root.remediation, /www\.matiasbaldanza\.dev/);
    assert.match(root.remediation, /annex doctor https:\/\/www\.matiasbaldanza\.dev\/basement/);
  });

  it("does not blame next.config.ts for a domain-level redirect", () => {
    for (const id of ["no-redirect-loop", "trailing-slash-host", "canonical-no-redirect", "public-url-200"]) {
      const result = verdict(results, id);
      assert.equal(result.status, SKIP, `${id} should be blocked, not failed`);
      assert.match(result.detail, /blocked by/i);
    }
  });

  it("still runs the checks the redirect does not invalidate", () => {
    // main.body is the real HTML, fetched through the redirect, so anything
    // that only reads the document remains trustworthy and useful.
    assert.equal(verdict(results, "next-assets-under-basepath").status, PASS);
    assert.equal(verdict(results, "robots-meta").status, PASS);
  });

  it("reports exactly one failure", () => {
    assert.deepEqual(
      results.filter((result) => result.status === FAIL).map((result) => result.id),
      ["origin-canonical-host"],
    );
  });
});

describe("trailing-slash-host", () => {
  it("accepts Next's relative normalising redirect", () => {
    assert.equal(verdict(runChecks(healthyBundle()), "trailing-slash-host").status, PASS);
  });

  it("warns on an absolute Location even when the host is right", () => {
    const bundle = healthyBundle({
      slashed: {
        ...healthyBundle().slashed,
        chain: [
          {
            url: `${CONFIG.publicUrl}/`,
            status: 308,
            location: CONFIG.publicUrl,
            locationIsRelative: false,
            resolved: CONFIG.publicUrl,
          },
        ],
      },
    });
    assert.equal(verdict(runChecks(bundle), "trailing-slash-host").status, WARN);
  });

  it("fails when the host changes", () => {
    const bundle = healthyBundle({
      slashed: { ...healthyBundle().slashed, finalUrl: "https://basement.vercel.app/basement" },
    });
    assert.equal(verdict(runChecks(bundle), "trailing-slash-host").status, FAIL);
  });
});
