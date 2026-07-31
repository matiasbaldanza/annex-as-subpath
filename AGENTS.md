# annex-as-subpath

A tool that serves a separate Next.js app on a path of an existing site —
`example.dev/thing` — where the parent site is a different project in a
different repo.

Two halves: the path proxy (apex rewrites, child `basePath`, dedicated
subdomain, canonical URL) and the optional way-back link for visitors who
arrive through an unlisted page.

Read [`docs/decisions/`](docs/decisions/) for *why* things are the way they
are.

## Layout

```
src/cli.js       argument parsing and dispatch
src/config.js    public URL → origin + basePath, merged with flags and annex.json
src/probe.js     the network shell — everything that touches the world
src/html.js      scanners over served HTML
src/checks.js    the verdicts. Pure.
src/doctor.js    gather evidence, then judge it
src/report.js    formatting, kept separate so output can be snapshot-tested
test/fixtures/   real captures, not hand-written samples
tmp/             scratch prototypes, gitignored, never shipped
```

## Tooling

**pnpm only.** A stray `npm install` creates a second lockfile.
**Node ≥ 22.13** — `nvm use` first. pnpm 11's launcher fails on older Node with
`No such built-in module: node:sqlite`, which looks like a project error and is
not one. pnpm settings live in `pnpm-workspace.yaml`, not the `pnpm` field of
`package.json`, which pnpm 11 ignores.

```bash
pnpm test                                   # node:test, no network
node src/cli.js doctor https://example.dev/thing
```

## Hard rules

1. **Zero runtime dependencies.** Node's built-ins cover fetch, DNS, and
   argument parsing. The tool runs via `pnpm dlx` on other people's machines;
   every dependency is a download and a supply-chain surface for something that
   is, in the end, twelve HTTP requests and some regexes.

2. **Skipped is never passed.** A check that could not run returns `SKIP`. The
   failures this tool exists to catch are the silent kind — a certificate that
   stops renewing, a path that breaks weeks after the link was sent. A green
   tick for a check that never executed is the most expensive lie the tool
   could tell.

3. **Every non-pass carries `remediation`, with real values substituted.** The
   symptom is not the deliverable; the fix is. `assetPath("/logo.svg")`, not
   "use the helper". Vercel → project → Settings → Deployment Protection →
   Vercel Authentication → Require Log In → off → Save, not "disable
   protection". Every failure worth catching came from a dashboard or DNS step,
   so the instructions are the product.

4. **One root cause must not produce several wrong fixes.** A check that would
   misdiagnose when a prerequisite failed declares `blockedBy` and does not
   run. Telling someone to fix a file that is not broken is worse than telling
   them nothing. See ADR-0002.

5. **Checks are pure; only `probe.js` touches the network.** A check takes the
   gathered bundle and returns a verdict. This is what makes the HTML and
   header parsing testable against fixtures, which is where all the real logic
   is.

6. **Fixtures are real captures.** A hand-written fixture encodes the same
   assumptions as the scanner reading it, so both are wrong together and the
   test proves nothing. Broken variants are derived from the capture by one
   documented replacement, and the derivation asserts that it applied.

7. **Never mutate a file the tool did not create.** `init`/`apex` write new
   files and print paste-ready patches for existing ones. AST surgery on
   someone's `next.config.ts` is the least simple thing in this project, and
   simple beats general here. See ADR-0003.

8. **Nothing in `tmp/` ships.** Prototypes are versioned `vN` and never
   overwritten — a rejected version is evidence of the path taken.

## Working style

- Matías makes the commits and does the pushing. Do not commit or push unless
  asked.
- Conventional Commits, atomic, **no `Co-Authored-By` trailer**.

## Decisions

Structural decisions get an ADR in `docs/decisions/`, numbered, in
Context → Decision → Consequences form. **Ten to fifteen lines**, including the
dead ends — "tried X, it broke asset paths, switched to Y". Uniform, padded
ADRs read as machine output and destroy the signal they exist to send.
