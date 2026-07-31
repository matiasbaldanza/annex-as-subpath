# 3. Fixtures are real captures, broken variants are derived

## Context

All the interesting logic is HTML and header parsing, which is testable without
a network — but only if the HTML resembles what Next actually serves. Next
inlines its asset manifest into `self.__next_f.push(...)` as JSON string
literals, where paths appear with escaped slashes, and most `/_next/`
references live there rather than in a `src` attribute.

A first attempt used hand-written fixtures. They passed immediately, which was
the problem: the fixture and the scanner encoded the same assumption about
where asset paths appear, so they agreed with each other and proved nothing.
Attribute scanning alone missed the inlined manifest entirely.

## Decision

`test/fixtures/good.html` is a real capture of the live deployment. Broken
variants are derived from it inside the tests by a single documented string
replacement, and the helper asserts the replacement applied.

Rejected: committing five near-duplicate 8 KB files. They drift the moment the
capture is refreshed, and a stale fixture tests the past.

## Consequences

The scanners had to grow slash-unescaping and a count-based `/_next/` check to
survive a real document — a requirement the hand-written fixtures had hidden.

Refreshing the capture is one `curl`. If a derivation stops matching, the
assertion fails loudly rather than silently testing the good document twice.
