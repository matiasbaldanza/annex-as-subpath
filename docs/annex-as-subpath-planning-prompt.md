# Planning prompt — annex-as-subpath

Copy this into a fresh session in a new, empty repo. It is self-contained.

---

## What to build

A small tool that **integrates a separate Next.js app into an existing site**,
serving it on a path — for example `example.dev/thing` — where the parent site
is a different project in a different repo.

Two halves, both in scope:

1. **The path proxy.** Apex rewrites, child `basePath`, dedicated subdomain,
   canonical URL, and the verification that it all actually works.
2. **The way back.** An optional courtesy link: a visitor who arrives through
   the annexed app and later wanders to the parent's homepage gets offered a
   link back, because an unlisted page is deliberately not linked from
   anywhere. Optional, offered during setup, never mandatory.

I have done both once by hand; the mechanics are simple but there are about
eight ways to get them subtly wrong, and each one fails in a way that *looks
fine locally*.

I want to stop rediscovering that. Optimise for **simple and obvious** over
clever or general.

## The architecture it automates

Two projects, both on Vercel, one domain:

- **Apex** — the parent site (mine is static Astro, but it should not matter).
  Owns the domain. Its `vercel.json` rewrites `/thing` and `/thing/:path*` to
  the child app.
- **Child** — a Next.js app, its own repo and Vercel project, with
  `basePath: '/thing'`. Reached through a dedicated subdomain
  (`thing-app.example.dev`) so the rewrite target never changes when Vercel's
  generated alias does.

Rewrites, not redirects: the browser only ever sees the apex. This is Next's
documented **Multi-Zones** pattern — see
`node_modules/next/dist/docs/01-app/02-guides/multi-zones.md` in any Next 16
app. Note that doc reaches for `assetPrefix`; `basePath` is better here because
it prefixes routes *and* assets, so one wildcard rewrite carries everything
instead of needing a third rule.

## Everything I learned doing it by hand

This is the actual value of the tool. Every item below is verified, not
theoretical.

**Cloudflare DNS**
- The subdomain's CNAME must be **DNS-only (grey cloud)**, not proxied. Vercel
  issues and renews the TLS cert and validates by seeing the request reach its
  edge; with Cloudflare terminating TLS, validation fails or renewal silently
  stops. On Cloudflare "Flexible" SSL you also get a redirect loop.
- The CNAME target is **account-specific** (mine was
  `41f6e7a1e2e4f755.vercel-dns-017.com`). Never hardcode a target; always read
  it from the Vercel dashboard.
- TTL is greyed out while proxied — it becomes editable once the cloud is grey.

**Vercel**
- **Deployment Protection must be off** for production, or the apex's proxied
  request gets an SSO login page and the whole thing looks broken for the wrong
  reason. Turn it off *first*, before any other verification.
- Protection Bypass for Automation cannot rescue this: `vercel.json` rewrites
  cannot inject headers.

**Child app config**
- `basePath` is load-bearing, not cosmetic. Without it the app requests
  `/_next/*` at the apex root, which the apex doesn't serve — HTML loads and
  the page renders blank.
- `basePath` does **not** prefix files in `public/`. Raw `/logo.svg` works
  locally and 404s in production. Needs a helper, and a documented rule.
- **Never redirect `/thing/*` to the apex.** Apex proxies to the child, child
  301s to the apex, browser returns to the apex — infinite loop, and the
  canonical URL becomes the one URL that cannot load. There is no cheap way to
  condition it away: a proxied request and a direct visit arrive with the same
  `Host`, and rewrites can't inject a marker header for a `has` condition.
- Redirecting **bare `/` only** is safe, because with `basePath` set the proxy
  never requests `/`. Two flags matter: `basePath: false` (or the rule silently
  matches `/thing`), and `permanent: false` (301s cache hard in browsers).
- `metadataBase` should be the **public URL including the path**. Next treats a
  leading-slash metadata path as relative to the end of `metadataBase`, so
  `/og.png` correctly becomes `example.dev/thing/og.png`.
- Set `alternates.canonical` to the **absolute** public URL. A relative `"/"`
  resolves *with* a trailing slash, and Next 308s that back to the unslashed
  form — a canonical tag naming a URL that redirects.
- Trailing slash: Next's normalising redirect emits a **relative** `Location`,
  so it does not leak the deployment host. Worth verifying, not worth
  preemptively configuring.
- If the page should be unlisted: `robots: { index: false, follow: false }` and
  leave `robots.txt` **permissive**. Disallowing the path there advertises it,
  and a crawler blocked from fetching never sees the `noindex` tag anyway.

**The way-back marker**
- It is **`sessionStorage`, not a cookie**. Client-only, scoped per *origin*,
  dies with the tab. No cookies, no identifiers, nothing sent anywhere. Do not
  "improve" it into something more persistent.
- The contract is one key, read by the parent site:
  key `unlisted-entry`, value `{"label": string, "href": string}`.
- `label` is substituted into a sentence — "I believe you came here through
  ___" — so it must fit that grammar.
- `href` is resolved on the **parent's** origin, so it must be parent-relative
  (`/thing`), never the child's own host. It equals the child's `basePath` by
  construction, since the rewrite maps them one-to-one.
- Write it as an **inline script in a server component**, not a `useEffect`, so
  it runs before hydration and needs no `"use client"`. Wrap the storage call
  in `try/catch` — Safari private mode throws on access, and a courtesy feature
  must never break the page.
- Because storage is per-origin, this **only works through the parent's
  domain**. On the child's own host it writes to an origin the parent cannot
  read. That is expected, and it is the first thing to check when the banner
  seems broken.
- Multiple annexed apps share the one key, last writer wins. Intended: the
  banner names the most recently visited one, never two banners.
- With JavaScript disabled the banner must stay **hidden**, never appear empty
  or unstyled.

**Testing**
- `astro dev` (and any local dev server on the apex) ignores `vercel.json`, so
  the path 404s locally no matter what. Needs `vercel dev` or a preview deploy.
- The check that matters most: **every `_next` request must be under
  `/thing/`**. When this is broken the HTML still arrives, so the page looks
  correct on the child's own host and shatters behind the proxy.
- Order: child first, verify standalone, then the apex. Reversed, the first
  thing you see is a login page and you can't tell protection from a bad rule.

## What the tool should and should not do

**Should not:** touch DNS, touch the Vercel dashboard, or try to detect either.
Those are human steps.

**The human instructions are a deliverable, not a footnote.** Every failure I
hit doing this by hand came from a dashboard or DNS step, not from code. So the
generated instructions must be good enough to follow without knowing anything
about the architecture:

- **Exact navigation paths.** "Vercel → project → Settings → Deployment
  Protection → Vercel Authentication → Require Log In → off → Save." Not
  "disable deployment protection".
- **Exact field values as a table**, with the substituted names already filled
  in — for the DNS record: Type `CNAME`, Name `thing-app`, Target *(copy from
  the Vercel screen — it is account-specific)*, Proxy status **DNS only**, TTL
  Auto.
- **Numbered, in dependency order**, with the reason each step comes when it
  does. Protection off *before* verification, child deployed and verified
  *before* the apex, or the first symptom you see points at the wrong cause.
- **A copy-pasteable verification command after each step**, with the expected
  output stated. Not "check that it worked".
- **What the step looks like when it goes wrong**, inline. The grey-cloud step
  should say what a proxied record produces: `cf-ray` headers, a cert that
  never issues.
- **Anything requiring a value from a screen must say so explicitly**, because
  the CNAME target cannot be predicted and a guessed one fails confusingly.

Generate this into the target repo as a runbook file, with the real domain,
path, and subdomain substituted — not a generic template the human has to
translate. `docs/prompts/subdomain-setup.md` in the basement repo is a working
example of the shape and level of detail; ask me for it.

The same detail applies to `doctor` failures: every failed check prints the
remediation step, not just the symptom.

**My opinion, to be challenged:** the file-writing half is nearly trivial and
might be better as documented snippets than as code that mutates
`next.config.ts` — AST surgery on someone's config is the least simple thing
here. The genuinely valuable half is the **doctor**: the checks are tedious,
easy to skip, and catch real failures. Consider making the doctor the product
and the scaffolding a documented template. Push back if you disagree.

## Suggested command surface

Treat as a starting point, not a spec.

```bash
# in the child Next.js app: basePath, root redirect, metadata, public-path
# helper, optional way-back marker, and a runbook in docs/
pnpm dlx annex-as-subpath init

# in the parent repo: the two rewrite rules, and optionally the banner that
# reads the marker
pnpm dlx annex-as-subpath apex

# print the human steps for this project, with the real values filled in
pnpm dlx annex-as-subpath steps

# verify a live deployment; exits non-zero on failure
pnpm dlx annex-as-subpath doctor https://example.dev/thing
```

A short `bin` alias — `annex` — is worth having alongside the descriptive
package name, so the command doesn't read as long as the package name.

`steps` exists so the instructions can be re-read without re-running `init`,
and so the human half is a first-class command rather than output that
scrolled past.

`doctor` should check, against a real URL:
- CNAME resolves to Vercel, and **no** `cf-ray`/`cf-cache-status` headers.
- `200` on the public URL, no redirect chain, host unchanged.
- No `_next` or asset request at the apex root — parse the HTML.
- Canonical tag present, absolute, and does not itself redirect.
- `robots` meta matches the declared intent.
- Bare `/` on the child redirects to the public URL, and `/thing/x` does **not**
  redirect (loop detection).
- Trailing-slash variant does not change host.
- No `*.vercel.app` string in the served HTML.

## Constraints

- **Zero runtime dependencies** if at all possible. Node's built-ins cover
  fetch, DNS, and argument parsing.
- **pnpm only** — never `npm` or `yarn` in this repo. A stray `npm install`
  creates a second lockfile.
- **Node ≥ 22.13**, pinned in `.nvmrc`. pnpm 11's launcher fails on older Node
  with `No such built-in module: node:sqlite`, which looks like a project error
  and is not one. pnpm settings live in `pnpm-workspace.yaml`, not the `pnpm`
  field of `package.json`, which pnpm 11 ignores.
- Runnable without installing, via `pnpm dlx` — and it must not *assume* pnpm
  in the projects it operates on, since the apps it sets up may use anything.
- Clear failure messages: every check that fails should say *what to do*, not
  just what failed. The symptom→cause table is the model.
- Good `--help`. Someone should be able to use it without the README.

## Deliverables

0. The generated human runbook — the steps, the exact values, the per-step
   verification. If only one thing in this project is good, make it this.
1. The tool.
2. A README that explains the architecture first and the commands second — a
   reader should understand *why* the pieces exist. Include the
   symptom→cause table.
3. An `AGENTS.md` with the hard rules, each stating its reason.
4. ADRs in `docs/decisions/`, `Context → Decision → Consequences`, ten to
   fifteen lines, including dead ends. Terse. Padded ADRs read as machine
   output.

## Working style

- I make the commits and do the pushing. Propose the split and the messages,
  then wait.
- Conventional Commits, atomic, **no `Co-Authored-By` trailer**.
- Prototypes live in a gitignored `tmp/`, versioned `vN`, never overwritten.

## Decide with me before building

- **The parent side of the banner is the hard part.** The child is always
  Next.js, so writing the marker is easy. The parent can be anything — mine is
  Astro. Options: generate a framework-agnostic vanilla snippet the human
  drops in; generate for a couple of known frameworks; or ship only the child
  marker plus a documented contract and let the parent be hand-written. Tell me
  what you would pick and why. Do not assume the parent is Next.
- **Scope:** doctor-only, or scaffolding too?
- **Published to npm, or a repo I clone?** It doubles as a public work sample,
  which argues for polish either way.
- **How is it tested?** The interesting logic is HTML/header parsing, which is
  testable against fixtures without a network.

## Reference implementation

The child side exists and works today at `matiasbaldanza.dev/basement`. That
repo has the real `next.config.ts`, the public-path helper, the metadata block,
and a runbook in `docs/prompts/subdomain-setup.md`. Ask me for any of it rather
than guessing.
