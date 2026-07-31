/**
 * The checks.
 *
 * Every function here is pure: it takes the bundle of probe results gathered
 * by `doctor.js` and returns a verdict. No network, no clock, no filesystem —
 * so the interesting logic is testable against fixtures.
 *
 * Two rules hold for every check in this file:
 *
 *  1. A check that could not run returns SKIP, never PASS. Most of these
 *     failures are silent in production; a green tick for a check that never
 *     executed is worse than no tick at all.
 *
 *  2. Every non-pass carries `remediation` — the thing to *do*, with the real
 *     values already substituted. "Canonical tag is relative" is a symptom.
 *     "Set alternates.canonical to 'https://example.dev/thing'" is the tool
 *     doing its job.
 */

import {
  canonicalHref,
  robotsMeta,
  rootAbsoluteOffenders,
  unprefixedNextRefs,
  vercelAppHosts,
} from "./html.js";

export const PASS = "pass";
export const FAIL = "fail";
export const WARN = "warn";
export const SKIP = "skip";

const pass = (detail) => ({ status: PASS, detail });
const fail = (detail, remediation) => ({ status: FAIL, detail, remediation });
const warn = (detail, remediation) => ({ status: WARN, detail, remediation });
const skip = (detail, remediation) => ({ status: SKIP, detail, remediation });

/** Hostname of a URL string, or null if it will not parse. */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export const checks = [
  {
    id: "origin-canonical-host",
    title: "The apex answers on the host you asked about",
    run({ config, originRoot }) {
      if (!originRoot || originRoot.error) {
        return skip(`Could not reach ${config.origin}/: ${originRoot?.error ?? "no response"}`);
      }
      const asked = hostOf(config.origin);
      const answered = hostOf(originRoot.finalUrl);
      if (answered === asked) return pass(`${asked} answers directly.`);

      const wwwCase =
        answered === `www.${asked}` || asked === `www.${answered}`;
      const suggested = config.publicUrl.replace(`//${asked}`, `//${answered}`);

      return fail(
        `${asked} redirects to ${answered} (${originRoot.chain[0]?.status ?? "3xx"}).`,
        `Everything on ${asked} redirects to ${answered}, so ${config.publicUrl}\n` +
          `is not the URL that finally answers — the checks below would be\n` +
          `measuring the redirect rather than the app.\n\n` +
          (wwwCase
            ? `This is apex/www canonicalisation at the domain level, not an\n` +
              `annexing fault. Pick the canonical host and be consistent:\n\n`
            : `Pick the canonical host and be consistent:\n\n`) +
          `  - If ${answered} is canonical, re-run against:\n` +
          `        annex doctor ${suggested}\n` +
          `    and set alternates.canonical to that URL. A canonical tag naming\n` +
          `    ${config.publicUrl}\n` +
          `    names a URL that redirects.\n\n` +
          `  - If ${asked} is canonical, remove the redirect:\n` +
          `        Vercel → apex project → Settings → Domains → set which of the\n` +
          `        two is the primary domain and which redirects to it.`,
      );
    },
  },

  {
    id: "dns-cname",
    title: "Subdomain resolves to Vercel by CNAME",
    run({ config, cname }) {
      if (!config.subdomain) {
        return skip(
          "No subdomain given.",
          `Re-run with --subdomain thing-app.${hostOf(config.origin)} to check DNS.`,
        );
      }
      if (!cname || cname.records.length === 0) {
        return fail(
          `No CNAME record for ${config.subdomain}` +
            (cname?.error ? ` (${cname.error}).` : "."),
          `Two likely causes.\n` +
            `  1. The record does not exist. Create it in your DNS provider:\n` +
            `     Type CNAME, Name ${config.subdomain.split(".")[0]}, ` +
            `Target — copy from Vercel → project → Settings → Domains.\n` +
            `  2. The record exists but is proxied by Cloudflare, which flattens\n` +
            `     it to A records. Set Proxy status to "DNS only" (grey cloud).`,
        );
      }
      const target = cname.records[0];
      if (!/vercel-dns|vercel\.app$/i.test(target)) {
        return fail(
          `${config.subdomain} is a CNAME to ${target}, which is not Vercel.`,
          `Point it at the target shown on Vercel → project → Settings → Domains.\n` +
            `That target is account-specific — copy it from that screen. A value\n` +
            `from documentation or a blog post will be the wrong one.`,
        );
      }
      return pass(`CNAME → ${target}`);
    },
  },

  {
    id: "subdomain-not-proxied",
    title: "Subdomain is not behind Cloudflare's proxy",
    run({ config, subdomain }) {
      if (!config.subdomain) {
        return skip("No subdomain given.", "Re-run with --subdomain to check this.");
      }
      if (!subdomain || subdomain.error) {
        return fail(
          `Could not reach ${config.childOrigin}${config.basePath}: ` +
            `${subdomain?.error ?? "no response"}`,
          `If this is a certificate error, Vercel has not issued one yet. It\n` +
            `cannot, while Cloudflare terminates TLS in front of it: set the\n` +
            `record to "DNS only" (grey cloud) and wait for Vercel to mark the\n` +
            `domain Valid.`,
        );
      }
      const cf = Object.keys(subdomain.headers).filter((h) => h.startsWith("cf-"));
      if (cf.length > 0) {
        return fail(
          `Cloudflare headers present: ${cf.join(", ")}`,
          `The record is proxied (orange cloud). Set Proxy status to "DNS only".\n` +
            `Vercel issues and renews this certificate by seeing the request reach\n` +
            `its own edge; with Cloudflare in front, validation fails or renewal\n` +
            `silently stops months later. On Cloudflare's "Flexible" SSL mode you\n` +
            `also get a redirect loop.\n` +
            `TTL is greyed out while proxied — it becomes editable once grey.`,
        );
      }
      return pass(`No cf-* headers on ${config.subdomain}`);
    },
  },

  {
    id: "public-url-200",
    title: "Public URL returns 200 with no redirect and no host change",
    blockedBy: "origin-canonical-host",
    run({ config, main }) {
      if (main.error) {
        return fail(`${config.publicUrl}: ${main.error}`, remediationForUnreachable(config));
      }
      if (main.chain.length > 0) {
        const hops = main.chain
          .map((hop) => `${hop.status} → ${hop.resolved}`)
          .join("\n     ");
        return fail(
          `Redirected before responding:\n     ${hops}`,
          `The canonical URL must not redirect. If a hop lands back on\n` +
            `${config.origin}${config.basePath}, this is the loop: the apex proxies to\n` +
            `the child, the child 3xxs to the apex, the browser comes back. Only a\n` +
            `bare "/" may redirect — see the no-redirect-loop check.`,
        );
      }
      if (main.status !== 200) {
        if (main.status === 401 || main.status === 403) {
          return fail(
            `HTTP ${main.status} — this looks like Vercel's SSO login page.`,
            `Vercel → child project → Settings → Deployment Protection →\n` +
              `Vercel Authentication → Require Log In → off (Production) → Save.\n` +
              `Protection intercepts the apex's proxied request too, so leaving it\n` +
              `on makes every other check below fail for the wrong reason.\n` +
              `Protection Bypass for Automation cannot rescue this: vercel.json\n` +
              `rewrites cannot inject headers.`,
          );
        }
        return fail(`HTTP ${main.status}`, remediationForUnreachable(config));
      }
      const host = hostOf(main.finalUrl);
      if (host !== hostOf(config.origin)) {
        return fail(
          `Host changed to ${host}`,
          `Something returned a 3xx instead of being proxied. The browser must\n` +
            `only ever see ${hostOf(config.origin)}.`,
        );
      }
      return pass(`200, host stayed ${host}`);
    },
  },

  {
    id: "next-assets-under-basepath",
    title: `Every /_next/ request is under the basePath`,
    run({ config, main }) {
      if (!main.body) return skip("No HTML body to scan.");
      const { total, prefixed, unprefixed } = unprefixedNextRefs(main.body, config.basePath);
      if (total === 0) {
        return warn(
          "No /_next/ references found at all.",
          `Either this is not a Next.js app, or the HTML did not render. If the\n` +
            `page looks blank in a browser, that is the same symptom.`,
        );
      }
      if (unprefixed > 0) {
        return fail(
          `${unprefixed} of ${total} /_next/ references are not under ${config.basePath}/`,
          `Set basePath in next.config.ts:\n\n` +
            `    const nextConfig: NextConfig = { basePath: "${config.basePath}" };\n\n` +
            `This is the check that matters most. When it is broken the HTML still\n` +
            `arrives, so the page looks correct on the child's own host and\n` +
            `shatters behind the proxy — the app asks ${config.origin}/_next/…,\n` +
            `which the apex does not serve, and the page renders blank.`,
        );
      }
      return pass(`${prefixed}/${total} under ${config.basePath}/`);
    },
  },

  {
    id: "root-absolute-assets",
    title: "Root-absolute asset paths resolve",
    run({ config, main, assetProbes }) {
      if (!main.body) return skip("No HTML body to scan.");
      const offenders = rootAbsoluteOffenders(main.body, config.basePath);
      if (offenders.length === 0) return pass("None found.");

      if (!assetProbes) {
        return warn(
          `${offenders.length} root-absolute path(s) outside ${config.basePath}/: ` +
            offenders.map((o) => o.value).join(", "),
          `Each of these resolves at ${config.origin}, not at the annexed app.`,
        );
      }

      const broken = assetProbes.filter((probe) => probe.status !== 200);
      if (broken.length === 0) {
        return pass(
          `${offenders.length} outside ${config.basePath}/, but all served by the apex.`,
        );
      }
      return fail(
        broken.map((probe) => `${probe.value} → ${probe.status ?? probe.error}`).join("\n     "),
        `basePath does **not** prefix files in public/. A raw "/logo.svg" works\n` +
          `locally and 404s in production.\n\n` +
          `Use the helper from src/lib/base-path.ts at every call site that\n` +
          `basePath does not cover — next/image src, plain <img>/<link>/<video>,\n` +
          `fetches of static files, metadata URLs:\n\n` +
          `    assetPath("/logo.svg")  // -> "${config.basePath}/logo.svg"`,
      );
    },
  },

  {
    id: "canonical-absolute",
    title: "Canonical tag is present and absolute",
    run({ config, main }) {
      if (!main.body) return skip("No HTML body to scan.");
      const href = canonicalHref(main.body);
      if (!href) {
        return fail(
          "No <link rel=\"canonical\"> in the served HTML.",
          `In the root layout's metadata export:\n\n` +
            `    alternates: { canonical: "${config.publicUrl}" }\n\n` +
            `Absolute on purpose — see the next check.`,
        );
      }
      if (!/^https?:\/\//i.test(href)) {
        return fail(
          `Canonical is relative: ${href}`,
          `Set it to the absolute public URL:\n\n` +
            `    alternates: { canonical: "${config.publicUrl}" }\n\n` +
            `A relative "/" resolves against metadataBase *with* a trailing slash,\n` +
            `and Next 308s that back to the unslashed form — a canonical tag\n` +
            `naming a URL that redirects. An absolute value bypasses metadataBase\n` +
            `and names the final URL.`,
        );
      }
      if (href.replace(/\/+$/, "") !== config.publicUrl) {
        return fail(
          `Canonical is ${href}, expected ${config.publicUrl}`,
          `The canonical URL is the advertised one — the apex path, never the\n` +
            `child's own host or a *.vercel.app alias. Set\n` +
            `metadataBase to new URL("${config.publicUrl}") and\n` +
            `alternates.canonical to "${config.publicUrl}".`,
        );
      }
      return pass(href);
    },
  },

  {
    id: "canonical-no-redirect",
    title: "Canonical URL does not itself redirect",
    blockedBy: "origin-canonical-host",
    run({ canonicalProbe }) {
      if (!canonicalProbe) return skip("No absolute canonical URL to probe.");
      if (canonicalProbe.error) return fail(`Could not fetch: ${canonicalProbe.error}`);
      if (canonicalProbe.status >= 300 && canonicalProbe.status < 400) {
        return fail(
          `Canonical returns ${canonicalProbe.status} → ${canonicalProbe.resolved}`,
          `A canonical tag must name the URL that finally answers. Point it at\n` +
            `${canonicalProbe.resolved} — or find what is redirecting and stop it.`,
        );
      }
      return pass(`HTTP ${canonicalProbe.status}`);
    },
  },

  {
    id: "robots-meta",
    title: "robots meta matches the declared intent",
    run({ config, main }) {
      if (config.unlisted === null) {
        return skip(
          "Intent not declared.",
          "Re-run with --unlisted or --indexed, or set \"unlisted\" in annex.json.",
        );
      }
      if (!main.body) return skip("No HTML body to scan.");
      const content = robotsMeta(main.body);
      const noindex = content ? /\bnoindex\b/.test(content) : false;

      if (config.unlisted && !noindex) {
        return fail(
          content ? `robots = "${content}"` : "No robots meta tag.",
          `Declared unlisted. In the root layout's metadata export:\n\n` +
            `    robots: { index: false, follow: false }\n\n` +
            `Leave robots.txt permissive — see the next check.`,
        );
      }
      if (!config.unlisted && noindex) {
        return fail(
          `robots = "${content}" but --indexed was declared.`,
          `Remove robots: { index: false } from the metadata export, or re-run\n` +
            `with --unlisted if the page really is meant to stay out of search.`,
        );
      }
      return pass(content ? `robots = "${content}"` : "No robots meta, and none wanted.");
    },
  },

  {
    id: "robots-txt-permissive",
    title: "robots.txt does not advertise the path",
    run({ config, robotsTxt }) {
      if (config.unlisted !== true) return skip("Only checked for unlisted pages.");
      if (!robotsTxt || robotsTxt.error || robotsTxt.status !== 200) {
        return pass("No robots.txt served — nothing advertising the path.");
      }
      if (robotsTxt.body?.includes(config.basePath)) {
        return fail(
          `${config.origin}/robots.txt mentions ${config.basePath}`,
          `Remove that line. Disallowing an unlisted path in robots.txt\n` +
            `advertises it — robots.txt is public and routinely scraped for\n` +
            `exactly this. A crawler blocked from fetching the page never sees\n` +
            `the noindex tag anyway, so the Disallow is strictly worse than\n` +
            `nothing. Keep robots.txt permissive and let the meta tag do the work.`,
        );
      }
      return pass(`robots.txt does not mention ${config.basePath}`);
    },
  },

  {
    id: "child-root-redirect",
    title: "Bare / on the child redirects to the public URL",
    run({ config, childRoot }) {
      if (!config.subdomain) return skip("No subdomain given.");
      if (!childRoot || childRoot.error) {
        return fail(`Could not reach ${config.childOrigin}/: ${childRoot?.error ?? "no response"}`);
      }
      if (childRoot.status < 300 || childRoot.status >= 400) {
        return warn(
          `HTTP ${childRoot.status}, expected a redirect.`,
          `Optional, but it rescues anyone who lands on the deployment host\n` +
            `directly. In next.config.ts:\n\n` +
            `    redirects: async () => [{\n` +
            `      source: "/",\n` +
            `      destination: "${config.publicUrl}",\n` +
            `      basePath: false,   // else Next prefixes the source with ${config.basePath}\n` +
            `      permanent: false,  // 301s cache hard in browsers\n` +
            `    }]`,
        );
      }
      if (childRoot.resolved?.replace(/\/+$/, "") !== config.publicUrl) {
        return fail(
          `Redirects to ${childRoot.resolved}, expected ${config.publicUrl}`,
          `Set the redirect destination to the canonical public URL.`,
        );
      }
      if (childRoot.status === 301 || childRoot.status === 308) {
        return warn(
          `Redirects to ${config.publicUrl}, but permanently (${childRoot.status}).`,
          `Use permanent: false. A 301 caches hard in browsers, so if this ever\n` +
            `needs to change you cannot reach the people who already have it.`,
        );
      }
      return pass(`${childRoot.status} → ${config.publicUrl}`);
    },
  },

  {
    id: "no-redirect-loop",
    title: "Paths under the basePath do not redirect to the apex",
    blockedBy: "origin-canonical-host",
    run({ config, loop }) {
      if (!loop || loop.error) return skip(`Could not probe: ${loop?.error ?? "no response"}`);
      if (loop.status >= 300 && loop.status < 400) {
        return fail(
          `${loop.requestedUrl} returns ${loop.status} → ${loop.resolved}`,
          `Never redirect ${config.basePath}/* to the apex. The apex proxies to\n` +
            `the child, the child 3xxs to the apex, the browser comes back — an\n` +
            `infinite loop, and the canonical URL becomes the one URL that cannot\n` +
            `load.\n\n` +
            `There is no cheap way to condition it away: a proxied request and a\n` +
            `direct visit arrive with the same Host, and rewrites cannot inject a\n` +
            `marker header for a "has" condition. Redirect bare "/" only, with\n` +
            `basePath: false.`,
        );
      }
      return pass(`HTTP ${loop.status} — no redirect (a 404 here is correct).`);
    },
  },

  {
    id: "trailing-slash-host",
    title: "Trailing-slash variant stays on the same host",
    blockedBy: "origin-canonical-host",
    run({ config, slashed }) {
      if (slashed.error) return fail(`${config.publicUrl}/: ${slashed.error}`);
      const host = hostOf(slashed.finalUrl);
      if (host !== hostOf(config.origin)) {
        return fail(
          `${config.publicUrl}/ ended on ${host}`,
          `The trailing-slash normalisation is leaking the deployment host.\n` +
            `Next's own normalising redirect emits a *relative* Location and is\n` +
            `safe; an absolute one is coming from somewhere else — check for a\n` +
            `redirect rule naming a host explicitly.`,
        );
      }
      const absolute = slashed.chain.filter((hop) => !hop.locationIsRelative);
      if (absolute.length > 0) {
        return warn(
          `Redirected with an absolute Location: ${absolute[0].location}`,
          `It lands on the right host today, but an absolute Location in a\n` +
            `proxied response is one rename away from leaking. Prefer relative.`,
        );
      }
      return pass(
        slashed.chain.length === 0
          ? `200, no redirect`
          : `${slashed.chain[0].status} (relative) → ${slashed.finalUrl}`,
      );
    },
  },

  {
    id: "no-vercel-app-in-html",
    title: "No *.vercel.app host in the served HTML",
    run({ main }) {
      if (!main.body) return skip("No HTML body to scan.");
      const hosts = vercelAppHosts(main.body);
      if (hosts.length > 0) {
        return fail(
          hosts.join(", "),
          `A deployment host in the served HTML is a second, uncanonical URL for\n` +
            `the same page. Anything that follows it leaves the apex origin — and\n` +
            `the way-back marker is scoped per origin, so it silently stops\n` +
            `working there. Replace these with the public URL or a relative path.`,
        );
      }
      return pass("None found.");
    },
  },
];

function remediationForUnreachable(config) {
  return (
    `Check, in this order:\n` +
    `  1. Deployment Protection is off for Production on the child project.\n` +
    `  2. The apex's vercel.json has BOTH rules — the bare path and the\n` +
    `     wildcard. With only the wildcard, ${config.basePath} itself 404s:\n\n` +
    `       { "source": "${config.basePath}",         "destination": "…${config.basePath}" }\n` +
    `       { "source": "${config.basePath}/:path*",  "destination": "…${config.basePath}/:path*" }\n\n` +
    `  3. The apex has actually been deployed since that file changed. A local\n` +
    `     dev server ignores vercel.json entirely, so the path 404s locally no\n` +
    `     matter what — use \`vercel dev\` or a preview deployment.`
  );
}
