/**
 * Orchestration: gather evidence, then judge it.
 *
 * The split matters. Everything network-shaped happens in `gather`, which
 * returns a plain object; every verdict happens in `checks.js`, which is pure.
 * That is what makes the interesting logic — the HTML and header parsing —
 * testable against fixtures with no network at all.
 */

import { checks, FAIL, SKIP } from "./checks.js";
import { canonicalHref, rootAbsoluteOffenders } from "./html.js";
import { probe, probeNoFollow, resolveCname } from "./probe.js";

/**
 * A path that will not exist in any real app, used to prove that requests
 * under the basePath are *not* redirected. A 404 here is the passing result.
 */
const LOOP_PROBE_PATH = "/_annex-doctor-loop-probe";

/** How many root-absolute assets to actually fetch. Enough to be useful. */
const MAX_ASSET_PROBES = 10;

export async function gather(config, { fetchImpl, resolver } = {}) {
  const net = { fetchImpl, timeout: config.timeout };

  const [main, slashed, loop, originRoot, robotsTxt, childRoot, subdomain, cname] =
    await Promise.all([
      probe(config.publicUrl, net),
      probe(`${config.publicUrl}/`, net),
      probeNoFollow(`${config.publicUrl}${LOOP_PROBE_PATH}`, net),
      // The apex root, to tell an annexing fault apart from a domain-level
      // apex/www redirect that makes every URL underneath it redirect too.
      probe(`${config.origin}/`, net),
      probe(`${config.origin}/robots.txt`, net),
      config.childOrigin ? probeNoFollow(`${config.childOrigin}/`, net) : null,
      config.childOrigin ? probe(`${config.childOrigin}${config.basePath}`, net) : null,
      config.subdomain ? resolveCname(config.subdomain, { resolver }) : null,
    ]);

  // Second stage: these depend on what the HTML turned out to contain.
  const bundle = {
    config,
    main,
    slashed,
    loop,
    originRoot,
    robotsTxt,
    childRoot,
    subdomain,
    cname,
  };

  if (main.body) {
    const href = canonicalToProbe(main.body);
    bundle.canonicalProbe = href ? await probeNoFollow(href, net) : null;

    // Fetching the offenders turns a heuristic into a fact: a root-absolute
    // path that the apex happens to serve is harmless, and one that 404s is
    // the public/ bug. Only the second deserves to fail a build.
    //
    // Redirects are followed here: the question is whether the asset is
    // *served*, and on a domain that canonicalises apex to www every one of
    // them answers via a 3xx. Treating that as a 404 would be a false alarm.
    const offenders = rootAbsoluteOffenders(main.body, config.basePath).slice(0, MAX_ASSET_PROBES);
    bundle.assetProbes = await Promise.all(
      offenders.map(async ({ value }) => {
        const result = await probe(`${config.origin}${value}`, net);
        return { value, status: result.status, error: result.error };
      }),
    );
  }

  return bundle;
}

/**
 * The canonical URL, but only if it is absolute — a relative one is already a
 * failure in its own check, and resolving it here would probe a URL the
 * browser would never be sent to.
 */
function canonicalToProbe(html) {
  const value = canonicalHref(html);
  return value && /^https?:\/\//i.test(value) ? value : null;
}

/**
 * Run every check against a gathered bundle. Pure.
 *
 * A check declaring `blockedBy` does not run when its prerequisite failed. The
 * point is not tidiness — it is that a downstream check would otherwise report
 * a *confident and wrong* diagnosis. When the whole apex redirects to www,
 * every URL under it redirects too, and the loop check would blame a redirect
 * rule in next.config.ts that does not exist. Telling someone to fix the wrong
 * file is worse than telling them nothing.
 */
export function runChecks(bundle) {
  const failed = new Set();
  const byId = new Map(checks.map((check) => [check.id, check]));
  const results = [];

  for (const check of checks) {
    let result;
    if (check.blockedBy && failed.has(check.blockedBy)) {
      const cause = byId.get(check.blockedBy);
      result = {
        status: SKIP,
        detail: `Not run — blocked by "${cause.title}".`,
        remediation:
          `Fix that first. Until it passes, this check measures the redirect\n` +
          `rather than the app, and any verdict it gave would point at the\n` +
          `wrong file.`,
      };
    } else {
      result = check.run(bundle);
    }

    if (result.status === FAIL) failed.add(check.id);
    results.push({ id: check.id, title: check.title, ...result });
  }

  return results;
}

/** True if anything failed. Warnings and skips do not fail the run. */
export function hasFailures(results) {
  return results.some((result) => result.status === FAIL);
}
