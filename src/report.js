/**
 * Formatting the verdicts.
 *
 * Kept separate from the checks and from stdout so the output can be
 * snapshot-tested. The remediation text *is* the product of this tool, so it
 * should break a test when it changes, not slip out unnoticed.
 */

import { FAIL, PASS, SKIP, WARN } from "./checks.js";

const MARK = { [PASS]: "PASS", [FAIL]: "FAIL", [WARN]: "WARN", [SKIP]: "SKIP" };

const COLOR = {
  [PASS]: "\u001b[32m",
  [FAIL]: "\u001b[31m",
  [WARN]: "\u001b[33m",
  [SKIP]: "\u001b[90m",
};
const DIM = "\u001b[90m";
const RESET = "\u001b[0m";

export function supportsColor(env = process.env, stream = process.stdout) {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR) return true;
  return Boolean(stream.isTTY);
}

/**
 * Render results as text.
 *
 * Remediation is printed inline, under the check that failed — not collected
 * into a footer. A footer is a second place to look, and the whole complaint
 * that started this tool is that the fix and the symptom were never in the
 * same place.
 */
export function format(results, config, { color = false } = {}) {
  const paint = (status, text) => (color ? `${COLOR[status]}${text}${RESET}` : text);
  const dim = (text) => (color ? `${DIM}${text}${RESET}` : text);

  const lines = [];
  lines.push(`Checking ${config.publicUrl}`);
  lines.push(
    dim(
      config.subdomain
        ? `  via ${config.subdomain}`
        : `  no --subdomain given: DNS and proxy checks will be skipped`,
    ),
  );
  lines.push("");

  for (const result of results) {
    lines.push(`${paint(result.status, MARK[result.status])}  ${result.title}`);
    if (result.detail) {
      for (const line of String(result.detail).split("\n")) lines.push(dim(`     ${line}`));
    }
    if (result.remediation) {
      lines.push("");
      for (const line of String(result.remediation).split("\n")) lines.push(`     ${line}`);
    }
    lines.push("");
  }

  lines.push(summary(results, { color }));
  return lines.join("\n");
}

export function summary(results, { color = false } = {}) {
  const count = (status) => results.filter((result) => result.status === status).length;
  const failed = count(FAIL);
  const skipped = count(SKIP);

  const parts = [
    `${count(PASS)} passed`,
    `${failed} failed`,
    `${count(WARN)} warned`,
    `${skipped} skipped`,
  ];
  const line = parts.join(", ");

  if (failed > 0) {
    const text =
      `${line}\n\n` +
      `Work top-down. Later failures are frequently caused by earlier ones, and\n` +
      `a check blocked by a failure above it did not run at all.`;
    return color ? `${COLOR[FAIL]}${text}${RESET}` : text;
  }
  if (skipped > 0) {
    return (
      `${line}\n\n` +
      `Skipped is not passed — those checks did not run. Pass --subdomain and\n` +
      `--unlisted/--indexed to run them.`
    );
  }
  return color ? `${COLOR[PASS]}${line}${RESET}` : line;
}
