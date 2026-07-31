# 2. A failed prerequisite blocks the checks it would misdiagnose

## Context

The first live run against `matiasbaldanza.dev/basement` reported four
failures. All four had one cause: the domain canonicalises apex to `www`, so
every URL under it answers via a 307.

Three of the four printed a confident and wrong diagnosis. The loop check said
"never redirect `/basement/*` to the apex" and pointed at a redirect rule in
`next.config.ts` that does not exist. The trailing-slash check blamed a leaking
deployment host. Following any of that advice would have broken a working
config to fix a domain setting.

Ordering was already understood — the runbook says to turn Deployment
Protection off first, or the first symptom points at the wrong cause — but it
was written as advice to the human rather than enforced by the tool.

## Decision

A check may declare `blockedBy: <id>`. If that check failed, it does not run
and reports `SKIP` naming the cause. A new `origin-canonical-host` check probes
the apex root and identifies a domain-level redirect once, with remediation
that offers both directions (re-run against www, or change the primary domain).

Checks that only read the fetched document still run: the HTML was retrieved
through the redirect and is the real thing.

## Consequences

One root cause yields one failure. `SKIP` now carries two distinct meanings —
"no evidence given" and "blocked" — separated by the detail line, not the
status.

A check whose `blockedBy` is wrong hides a real problem, so the graph stays
shallow and each edge needs a reason.
