# Roadmap

Where the project is, what is next, and what it deliberately will not do.
Ordering is by dependency, not by appeal.

## Done

- **`doctor`** — 14 checks against a live URL: DNS and Cloudflare proxy status,
  redirect and host stability, `/_next/` under the basePath, canonical absolute
  and non-redirecting, robots intent, `robots.txt` not advertising an unlisted
  path, loop detection, trailing-slash host stability, no deployment host in
  the served HTML.
- **Blocked checks** — a failed prerequisite suppresses the checks it would
  misdiagnose, so one root cause yields one failure. Forced by the first live
  run. ADR-0002.
- **Skip semantics** — a check that could not run reports `SKIP`, never `PASS`.
- **Config** — public URL parsing, flags, and `annex.json`, flags winning.
- **Tests** — 54, no network, fixtures captured from the live deployment rather
  than hand-written. ADR-0003.
- **`steps`** — the runbook generator. Ten dependency-ordered steps with exact
  navigation paths, a DNS field-value table, a verification command after each
  with its expected output, and the failure symptom inline. Every value
  substituted; the CNAME target is the only thing read off a screen, and says
  so. Tests assert no placeholder and no reference-project value survives into
  the output.
- **Docs** — README, `AGENTS.md`, ADRs 0001–0003, MIT `LICENSE`.
- npm name `annex-as-subpath` confirmed available. Not yet published.

## Next

1. **`init`.** Emits into the child app: `base-path.ts` with the `assetPath`
   helper, the way-back marker, the runbook. New files only; paste-ready
   patches for `next.config.ts` and the layout. ADR-0001.

2. **`apex`.** Emits into the parent repo: the two rewrite rules, and the
   optional vanilla way-back banner — hidden by default, `try/catch` around
   the read, `label` via `textContent`, `href` validated as parent-relative.

3. **A local fake apex, for `probe.js`.** A small `node:http` server emitting
   the pathologies on demand — `cf-ray` headers, a 301 loop, an absolute
   `Location`, a body with root-level `/_next/`. Currently the probe layer is
   the one part with no test but the single live run that happened to hit a
   mostly-healthy site.

4. **End-to-end against a throwaway app.** A fresh `create-next-app`, its own
   Vercel project and subdomain, a second path on the same zone. Break one
   dashboard thing at a time — protection on, cloud orange — and confirm the
   doctor names the right cause. The only way to test the dashboard-side
   failures, and the only honest test of whether the runbook can be followed by
   someone who does not already know the architecture.

   Explicitly **not** by reverting the reference implementation: that repo's
   comments already contain the answers, and DNS and dashboard state do not
   revert with git.

5. **Publish.** After 4, not before.

## Decided, not yet built

Settled at the outset; recorded so they are not relitigated.

- Parent banner ships as **one framework-agnostic vanilla snippet** plus the
  documented contract — not per-framework generation, not contract-only. Needs
  an ADR when built.
- Scaffolding **emits files and prints patches**; it never edits a file it did
  not create. ADR-0001.
- Published to **npm**, because `pnpm dlx` is the stated entry point and does
  not work from a clone.
- Tested with **`node:test` against fixtures**, network isolated to `probe.js`.

## Open

- The way-back contract deserves its own ADR: `sessionStorage` over a cookie,
  one shared key with last-writer-wins, inline script over `useEffect`.
- Whether `docs/annex-as-subpath-planning-prompt.md` moves under
  `docs/prompts/`. Left in place for now; in the reference repo that directory
  means prompts handed over *from* the apex, which this is not.
- Whether `doctor` should offer a `--fix`-adjacent mode. Leaning no: the
  failures are overwhelmingly in dashboards and DNS, which the tool does not
  touch by design.

## Not doing

- **Touching DNS or the Vercel dashboard, or trying to detect either beyond
  what a request reveals.** Those are human steps; the deliverable is
  instructions good enough to follow.
- **AST surgery on someone's `next.config.ts`.** The least simple thing
  available, on the one file that can break a working repo.
- **Making the way-back marker more persistent.** It is session-scoped,
  origin-scoped, and dies with the tab, on purpose. It is a courtesy, not
  analytics.
- **Generality about the parent framework.** The parent can be anything, which
  is an argument for one snippet that works everywhere, not for a matrix of
  generators that each work once.
