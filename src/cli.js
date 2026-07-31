#!/usr/bin/env node
/**
 * The command line.
 *
 * Argument parsing is `node:util`'s parseArgs — a built-in, because zero
 * runtime dependencies is a hard rule and this is the one place a CLI is
 * tempted to break it.
 */

import { parseArgs } from "node:util";

import { loadConfigFile, resolveConfig, UsageError } from "./config.js";
import { gather, hasFailures, runChecks } from "./doctor.js";
import { format, supportsColor } from "./report.js";

const HELP = `annex-as-subpath — serve a separate Next.js app on a path of an existing site

USAGE
  annex <command> [options]

COMMANDS
  doctor <url>    Verify a live deployment. Exits non-zero on failure.
  help            This.

DOCTOR
  annex doctor https://example.dev/thing [options]

  The URL is the public one, including the path — that is the thing the
  visitor types and the thing every check is written against.

  --subdomain <host>   The dedicated subdomain the apex rewrites to, e.g.
                       thing-app.example.dev. Without it the DNS and
                       Cloudflare-proxy checks are SKIPPED, not passed.
  --unlisted           The page is meant to stay out of search results.
  --indexed            The page is meant to be indexed.
                       Without either, the robots checks are SKIPPED.
  --timeout <ms>       Per-request timeout. Default 10000.
  --json               Machine-readable results on stdout.

  Values also come from an annex.json in the current directory, if there is
  one; flags win over the file.

EXIT CODES
  0   No check failed. Warnings and skips do not fail the run.
  1   At least one check failed.
  2   Bad usage — the tool could not work out what to check.

NOTES
  Skipped is never passed. A check that could not run says so, because the
  failures this tool catches are the silent kind.

  A local dev server ignores vercel.json, so the annexed path 404s locally no
  matter what is configured. Point the doctor at a preview or production
  deployment, or run the apex under \`vercel dev\`.
`;

const OPTIONS = {
  subdomain: { type: "string" },
  unlisted: { type: "boolean" },
  indexed: { type: "boolean" },
  timeout: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

export async function main(argv = process.argv.slice(2), io = console) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    io.error(`${error.message}\n\nRun \`annex help\` for usage.`);
    return 2;
  }

  const { values: flags, positionals } = parsed;
  const [command, ...rest] = positionals;

  if (flags.help || !command || command === "help") {
    io.log(HELP);
    return command && command !== "help" ? 2 : 0;
  }

  if (command !== "doctor") {
    io.error(`Unknown command: ${command}\n\nRun \`annex help\` for usage.`);
    return 2;
  }

  let config;
  try {
    config = resolveConfig({ url: rest[0], flags, file: loadConfigFile() });
  } catch (error) {
    if (error instanceof UsageError) {
      io.error(error.message);
      return 2;
    }
    throw error;
  }

  const bundle = await gather(config);
  const results = runChecks(bundle);

  if (flags.json) {
    io.log(JSON.stringify({ config, results }, null, 2));
  } else {
    io.log(format(results, config, { color: supportsColor() }));
  }

  return hasFailures(results) ? 1 : 0;
}

// Only run when invoked as a binary, so tests can import `main` freely.
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
