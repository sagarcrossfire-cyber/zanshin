# ZANSHIN — instructions for Claude

Read `docs/REFERENCE.md` before doing anything: core concept, rules, where things are, how to ship, the
root-cause protocol and the failure catalog. The current major-version plan is `docs/v2/PLAN.md`; past failures
are in `docs/ops/RCA_LOG.md`.

Non-negotiables:
- Sagar's private Yoshimitsu coaching app, beginner to master. Every feature plugs into the loop
  Path → Today → train → Match Log → Progress → adapt.
- Only repositories touch IndexedDB; screens never call `fetch`; colours only in `src/styles/tokens.css`;
  domain code pure. AA contrast in every scheme; no cropped art.
- Ship only through a PR with green checks; never commit secrets (public repo); never ask Sagar for passwords
  or tokens.
- On any failure: evidence → reproduce → classify → five whys → fix the cause + add a guard → log it.
- Update `docs/REFERENCE.md` and `docs/ops/RCA_LOG.md` in the same PR as the change they describe.
