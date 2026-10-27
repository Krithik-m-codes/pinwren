# ADR 0022 — Enforce release quality gates and document capture budget

**Status:** accepted

The original screenshot capture target was 75 KiB gzip. SnapDOM itself is approximately 88 KiB gzip,
and the existing widget browser test already permits 92 KiB for the lazy capture chunk. Reporting a
75 KiB warning while allowing builds to succeed made the build report disagree with the release gate.

Use the existing 92 KiB limit for capture in both the build and browser tests, and fail the build when
any chunk exceeds its limit. Keep the core at 35 KiB and all other existing limits unchanged. This is
an explicit exception to the original capture target, not a claim that capture has become smaller.
The capture dependency remains lazy; reducing or replacing it is separate performance work.

CI also exercises the React wrapper, website accessibility/link tests, the fresh-install journey and
the API smoke suite. The journey and smoke use isolated job-local databases and test-only credentials.
Account-side npm trusted-publisher configuration remains necessary even with a correct OIDC workflow.
