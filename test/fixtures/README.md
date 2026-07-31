# Fixtures

`good.html` is a real capture, not a hand-written sample:

```bash
curl -sSL https://matiasbaldanza.dev/basement -o test/fixtures/good.html
```

That matters. A hand-written fixture encodes the same assumptions as the
scanner that reads it, so the two agree for the same wrong reason and the test
proves nothing. A real capture contains Next's inlined `self.__next_f` payload,
its escaped slashes, and its actual tag ordering — all of which the scanners
have to survive.

The broken variants are derived from `good.html` inside the tests by a single
documented string replacement each, rather than committed as near-duplicate
copies. Deriving them keeps every variant in sync when the capture is
refreshed; a stale copy that no longer resembles the real output is a fixture
that tests the past.

To refresh: re-run the curl above and re-run `pnpm test`. If a derivation stops
applying, the test fails loudly rather than silently testing nothing.
