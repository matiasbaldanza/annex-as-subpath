/**
 * Small scanners over served HTML.
 *
 * These are deliberately regex-based rather than a real parser. Zero runtime
 * dependencies is a hard rule, and the job here is closer to grep than to
 * parsing: find root-absolute asset paths, one canonical tag, one robots tag.
 * The cost is that a pathological document can fool them — so every finding is
 * reported with the offending string, and the human can see what was matched
 * rather than being asked to trust a verdict.
 */

/** Strip comments and CDATA so commented-out markup is not reported. */
function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Normalise escaped slashes.
 *
 * Next inlines its own asset manifest into `self.__next_f.push(...)` as JSON
 * string literals, where a path can appear as `\/_next\/`. Those are real
 * asset references and they must be scanned, so unescape before matching.
 */
function unescapeSlashes(html) {
  return html.replace(/\\\//g, "/");
}

/** Every `src`/`href` value in the document, in source order. */
export function attributeUrls(html) {
  const found = [];
  const re = /\b(src|href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/gi;
  let match;
  while ((match = re.exec(stripComments(html))) !== null) {
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    if (value) found.push({ attr: match[1].toLowerCase(), value });
  }
  return found;
}

/**
 * Root-absolute URLs that are not under `basePath`.
 *
 * This is the failure the whole tool exists to catch. When `basePath` is
 * missing — or when source hardcodes a raw `/logo.svg` for a file in
 * `public/` — the HTML still arrives intact, so the page looks correct on the
 * child's own host and shatters behind the proxy, where the apex has no idea
 * what `/logo.svg` means.
 *
 * Protocol-relative (`//host/x`) and absolute URLs are somebody else's origin
 * and are not our problem. Fragments and query-only values are not paths.
 */
export function rootAbsoluteOffenders(html, basePath) {
  const prefix = `${basePath}/`;
  const offenders = [];

  for (const { attr, value } of attributeUrls(html)) {
    if (!value.startsWith("/")) continue;
    if (value.startsWith("//")) continue;
    if (value === basePath || value.startsWith(prefix)) continue;
    offenders.push({ attr, value });
  }

  return offenders;
}

/**
 * Count `/_next/` references that are not prefixed by `basePath`.
 *
 * Counted rather than located because most of them live inside inlined JSON
 * rather than in an attribute, and a count is enough: the correct number of
 * unprefixed references is zero.
 */
export function unprefixedNextRefs(html, basePath) {
  const text = unescapeSlashes(stripComments(html));
  const total = (text.match(/\/_next\//g) ?? []).length;
  const prefixed = (
    text.match(new RegExp(`${escapeRegExp(basePath)}/_next/`, "g")) ?? []
  ).length;
  return { total, prefixed, unprefixed: total - prefixed };
}

/** The `href` of the first `<link rel="canonical">`, or null. */
export function canonicalHref(html) {
  const text = stripComments(html);
  const re = /<link\b[^>]*>/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const tag = match[0];
    if (!/\brel\s*=\s*["']?canonical\b/i.test(tag)) continue;
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (href) return (href[2] ?? href[3] ?? href[4] ?? "").trim();
  }
  return null;
}

/** The `content` of `<meta name="robots">`, lowercased, or null. */
export function robotsMeta(html) {
  const text = stripComments(html);
  const re = /<meta\b[^>]*>/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const tag = match[0];
    if (!/\bname\s*=\s*["']?robots["']?/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (content) {
      return (content[2] ?? content[3] ?? content[4] ?? "").trim().toLowerCase();
    }
  }
  return null;
}

/**
 * Every `*.vercel.app` hostname mentioned in the document.
 *
 * A deployment host in the served HTML is a leak: it is a second, uncanonical
 * URL for the same page, it bypasses the apex, and anything that follows it
 * lands outside the origin the way-back marker is scoped to.
 */
export function vercelAppHosts(html) {
  const text = unescapeSlashes(stripComments(html));
  const matches = text.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app/gi) ?? [];
  return [...new Set(matches.map((host) => host.toLowerCase()))];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
