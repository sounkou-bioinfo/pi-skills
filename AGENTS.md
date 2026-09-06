# Working in pi-skills

- For runtime/contract changes, use [the QA standard](EXTENSION_QA_STANDARD.md)
  and the affected rows of [TEST_PLAN.md](TEST_PLAN.md). For test commands,
  prerequisites, or a new harness, consult [the playbook](EXTENSION_TESTING_PLAYBOOK.md).
  These are references for the task, not a reading checklist before every edit.
- Prose-only changes need relevant link/render checks. Skill/prompt changes need
  routing/behavior review and affected checks. Runtime, build, and packaging
  changes need focused tests during development and `npm run check` before
  handoff, plus required boundary gates. Run suites serially in one checkout.
- `README.Rmd` is the README source; render it with `npm run render:readme` when
  changed. Put operating details in `docs/operations.md`.
- Continue through local implementation, verification, and fixes caused by the
  requested change without asking at each step. Ask before unrequested publishing,
  destructive operations, global configuration changes, or live/paid-service work.
- Preserve vendor attribution and user data; do not commit `.pi/`, credentials,
  machine-local logs, or test builds. Report unavailable gates and unrelated
  failures rather than expanding scope or treating them as passes.
