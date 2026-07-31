# 1. The doctor is the product; scaffolding never mutates existing files

## Context

The tool has two halves. Writing files — `basePath`, a public-path helper, a
metadata block, the way-back marker — is nearly trivial and mostly amounts to
copying eight known-good snippets. Verifying a live deployment is tedious,
easy to skip, and catches failures that all look fine locally: the page renders
on the child's own host and shatters behind the proxy.

The tempting version of scaffolding edits `next.config.ts` and `layout.tsx` in
place. That means AST surgery on someone else's config, which is the least
simple thing in the project and the only part that can damage a working repo.

## Decision

The doctor is the product. Scaffolding stays, but it only ever *creates* files
it owns — the helper, the marker, the runbook. For files that already exist it
prints a paste-ready patch with the real domain and path substituted, and
writes the same patch into the runbook.

Rejected: demoting scaffolding to snippets in the README. Snippets in a README
rot, and a generic template the human has to translate is the thing the runbook
exists to replace.

## Consequences

No blast radius: the worst case is an unused file. The human applies two small
edits by hand, which is also where they read the comments explaining why.

The runbook and `steps` carry weight the code does not, so their wording is a
deliverable and changes to it belong in review.
