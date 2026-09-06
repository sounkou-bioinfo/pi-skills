# Working in pi-skills

- Read [EXTENSION_QA_STANDARD.md](EXTENSION_QA_STANDARD.md), then use
  [EXTENSION_TESTING_PLAYBOOK.md](EXTENSION_TESTING_PLAYBOOK.md) and update
  [TEST_PLAN.md](TEST_PLAN.md) for the affected contract and coverage gaps.
- `README.Rmd` is the README source. Keep it short; put operating details in
  `docs/operations.md`. Render with `npm run render:readme`.
- Run `npm run check` serially and the boundary-specific gates required by the
  change. Report missing/skipped gates; fake Pi hooks are not SDK/PTY coverage.
- Preserve vendor attribution. Upstream testing claims are not local evidence.
- Do not commit `.pi/`, credentials, machine-local logs, or generated test builds.
