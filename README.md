# annex-as-subpath

Serve a separate Next.js app on a path of an existing site — `example.dev/thing`
— where the parent site is a different project, in a different repo, possibly
in a different framework.

The mechanics are simple. There are about eight ways to get them subtly wrong,
and **each one fails in a way that looks fine locally**. This tool exists so
those eight are checked rather than rediscovered.

## Status

Work in progress, built for my own use, evolving as I need more from it. No
stability guarantees: the command surface, the check ids, and the output format
can all change without ceremony. It is published to npm so `pnpm dlx` works,
not as a promise of support.

Currently implemented: `doctor` and `help`. The scaffolding commands (`init`,
`apex`, `steps`) and the generated runbook are next.

If it is useful to you, take it. If it breaks something, that is the deal above.

## Where this came from

I annexed a Next.js app onto `matiasbaldanza.dev/basement` by hand. Everything
this tool checks is something that actually went wrong, or that I verified in
order to find out it wouldn't — not a list of things that seem plausible.

The checks kept their value immediately: the first run against my own
already-working deployment found that the domain canonicalises apex to `www`,
which made my canonical tag name a URL that redirects. I had verified that tag
by hand and still missed it, because the redirect happens at the domain level
and the page looks perfect either way.

That is the whole thesis. These failures are not hard, they are *quiet*.

## The architecture

Two projects, both on Vercel, one domain.

**Apex** — the parent site, which owns the domain. Mine is static Astro; it
should not matter. Its `vercel.json` rewrites two paths to the child:

```json
{
  "rewrites": [
    { "source": "/thing",         "destination": "https://thing-app.example.dev/thing" },
    { "source": "/thing/:path*",  "destination": "https://thing-app.example.dev/thing/:path*" }
  ]
}
```

Both rules are needed. With only the wildcard, `/thing` itself 404s.

**Child** — a Next.js app, its own repo and Vercel project, with
`basePath: '/thing'`.

**Rewrites, not redirects.** The browser only ever sees the apex. This is
Next's documented Multi-Zones pattern — `node_modules/next/dist/docs/01-app/
02-guides/multi-zones.md` in any Next 16 app.

### Why a dedicated subdomain

The rewrite targets `thing-app.example.dev`, not the generated `*.vercel.app`
alias. The generated alias changes if the project or account is renamed; a
hostname you own does not. Nothing but the apex rewrite ever requests it, and
the advertised URL stays `example.dev/thing`.

Its DNS record must be **CNAME, DNS-only (grey cloud)**. Vercel issues and
renews that certificate by seeing the request reach its own edge; with
Cloudflare terminating TLS, validation fails or renewal silently stops months
later. The CNAME target is account-specific — always read it off the Vercel
screen, never from documentation.

### Why `basePath` and not `assetPrefix`

Next's own multi-zones guide reaches for `assetPrefix`. `basePath` is better
here because it prefixes routes *and* assets, so one wildcard rewrite carries
everything instead of needing a third rule.

`basePath` is load-bearing, not cosmetic. Without it the app requests
`/_next/*` at the apex root, which the apex does not serve — the HTML arrives,
the page renders blank. It looks correct on the child's own host and shatters
behind the proxy, which is why the doctor treats this as its central check.

**`basePath` does not prefix files in `public/`.** A raw `/logo.svg` works
locally and 404s in production. That needs a helper and a documented rule.

### Why only bare `/` may redirect

Never redirect `/thing/*` to the apex. The apex proxies to the child, the child
301s to the apex, the browser comes back through the apex — an infinite loop,
and the canonical URL becomes the one URL that cannot load.

There is no cheap way to condition it away: a proxied request and a direct
visit arrive with the same `Host`, and rewrites cannot inject a marker header
for a `has` condition.

Redirecting **bare `/` only** is safe, because with `basePath` set the proxy
never requests `/`. Two flags matter: `basePath: false`, or the rule silently
matches `/thing`; and `permanent: false`, because 301s cache hard in browsers.

### The way back

A visitor who arrives through an unlisted annexed page and later wanders to the
parent's homepage has no way back — an unlisted page is deliberately not linked
from anywhere. The optional courtesy link fixes that.

The child writes one `sessionStorage` key; the parent reads it and offers a
link. The contract is:

```
key:   "unlisted-entry"
value: {"label": string, "href": string}
```

`label` is substituted into a sentence — "I believe you came here through ___"
— so it has to fit that grammar. `href` is resolved on the **parent's** origin,
so it must be parent-relative (`/thing`), never the child's own host.

**`sessionStorage`, not a cookie.** Client-only, scoped per origin, dies with
the tab. No cookies, no identifiers, nothing sent anywhere. It is a courtesy,
not analytics, and it should not become more persistent.

Because storage is per-origin, this only works through the parent's domain. On
the child's own host it writes to an origin the parent cannot read — expected,
and the first thing to check when the banner seems broken.

## Commands

```bash
pnpm dlx annex-as-subpath doctor https://example.dev/thing
```

Verifies a live deployment. Exits non-zero on failure.

```
--subdomain <host>   The subdomain the apex rewrites to. Without it, the DNS
                     and Cloudflare-proxy checks are SKIPPED, not passed.
--unlisted           The page should stay out of search results.
--indexed            The page should be indexed.
--timeout <ms>       Per-request timeout. Default 10000.
--json               Machine-readable results.
```

Values also come from an `annex.json` in the working directory; flags win.

Two things worth knowing about the output:

**Skipped is never passed.** A check that could not run says so. The failures
here are the silent kind, so a green tick for a check that never executed is
the most expensive lie the tool could tell.

**One root cause yields one failure.** A check that would misdiagnose while a
prerequisite is broken does not run — it reports what is blocking it. The first
live run reported four failures for a single cause and three of them confidently
blamed a file that was not broken; that is now structurally prevented.

Every failure prints the fix, with your values substituted, not just the
symptom.

### Testing locally

You cannot. A local dev server ignores `vercel.json`, so the annexed path 404s
locally no matter what is configured. This is the single most likely thing to
send you chasing a problem that does not exist. Use `vercel dev` on the apex, a
preview deployment, or production.

## Symptom → cause

| Symptom | Almost certainly |
| --- | --- |
| Vercel SSO / login page | Deployment Protection still on for Production |
| `cf-ray` header on the subdomain | Cloudflare proxy still on — needs grey cloud |
| Certificate invalid or never issues | Same: Vercel cannot validate through the proxy |
| HTML loads, page blank, 404s on `/_next/*` | `basePath` missing, or root-absolute paths in source |
| One image 404s, everything else fine | `public/` file referenced without the basePath helper |
| `ERR_TOO_MANY_REDIRECTS` | A blanket redirect back to the apex; only bare `/` may redirect |
| Address bar flips to another host | A 3xx passed through the proxy, or apex/www canonicalisation |
| Canonical tag names a URL that redirects | Relative canonical, or the apex canonicalises to `www` |
| Bare `/thing` 404s, `/thing/x` works | The non-wildcard rewrite rule is missing |
| Everything 404s, locally only | Expected — a local dev server ignores `vercel.json` |
| Way-back banner never appears | Reached the app on the child's host; storage is per-origin |

## Development

```bash
pnpm test    # node:test, no network
```

Zero runtime dependencies, by rule — Node's built-ins cover fetch, DNS, and
argument parsing. pnpm only, Node ≥ 22.13.

The checks are pure functions over a gathered bundle; only `src/probe.js`
touches the network. Fixtures are real captures rather than hand-written
samples, because a hand-written fixture encodes the same assumptions as the
scanner reading it and the two are then wrong together.

See [`AGENTS.md`](AGENTS.md) for the hard rules and
[`docs/decisions/`](docs/decisions/) for why things are the way they are.

## Licence

MIT.
