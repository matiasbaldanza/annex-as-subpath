/**
 * Configuration for the annexed app.
 *
 * Derived from the one value a human reliably has to hand — the public URL —
 * plus optional extras that unlock the checks the URL alone cannot support.
 *
 * Anything missing turns the checks that depend on it into SKIP, never PASS.
 * A silent green for a check that never ran is the single most expensive lie
 * this tool could tell: it is exactly the setup that looks fine until the
 * certificate stops renewing.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const CONFIG_FILE = "annex.json";

/** A problem with what the human typed, not with their deployment. */
export class UsageError extends Error {}

/**
 * Split "https://example.dev/thing" into its parts.
 *
 * The path is required. A bare origin is almost always a typo — this tool is
 * about serving an app *on a path*, and every check below is written against
 * one.
 */
export function parsePublicUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new UsageError(
      `Not a URL: ${input}\n` +
        `Expected something like https://example.dev/thing`,
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UsageError(`Expected an http(s) URL, got: ${url.protocol}//…`);
  }

  // Trailing slashes are stripped here so that basePath and publicUrl are
  // always in the unslashed form Next redirects *to*. The slashed variant is
  // still probed — as a separate check, not as the baseline.
  const basePath = url.pathname.replace(/\/+$/, "");

  if (!basePath) {
    throw new UsageError(
      `${url.origin} has no path.\n` +
        `Pass the full public URL of the annexed app, e.g. ${url.origin}/thing`,
    );
  }

  return { origin: url.origin, basePath, publicUrl: url.origin + basePath };
}

/** Read annex.json from `dir`, if it is there. Absent is not an error. */
export function loadConfigFile(dir = process.cwd()) {
  const path = resolve(dir, CONFIG_FILE);
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return { ...JSON.parse(raw), _path: path };
  } catch (error) {
    throw new UsageError(`${path} is not valid JSON: ${error.message}`);
  }
}

/**
 * Merge a URL argument, CLI flags, and annex.json into one config.
 *
 * Precedence is flags > file, because the file describes the repo you happen
 * to be standing in and the flags describe the thing you meant to check.
 */
export function resolveConfig({ url, flags = {}, file = null } = {}) {
  const source = url ?? flags.url ?? file?.publicUrl;

  if (!source) {
    throw new UsageError(
      `No URL given, and no ${CONFIG_FILE} in this directory.\n` +
        `Pass one:  annex doctor https://example.dev/thing`,
    );
  }

  const { origin, basePath, publicUrl } = parsePublicUrl(source);

  // The dedicated subdomain the apex rewrites to. Not derivable from the
  // public URL by design — the whole point of it is that it is a name you
  // chose, not one anybody can guess.
  const subdomain = flags.subdomain ?? file?.subdomain ?? null;

  // Whether the page is meant to be unlisted. Tri-state on purpose: `null`
  // means "you never said", which is a SKIP, not a pass.
  let unlisted = null;
  if (flags.unlisted) unlisted = true;
  else if (flags.indexed) unlisted = false;
  else if (typeof file?.unlisted === "boolean") unlisted = file.unlisted;

  return {
    origin,
    basePath,
    publicUrl,
    subdomain,
    childOrigin: subdomain ? `https://${subdomain}` : null,
    unlisted,
    timeout: Number(flags.timeout ?? 10_000),
  };
}
