# Changelog

## Unreleased

- Removed `jsonlite` from the webR control/signaling hot path for `FINAL(...)`, `FINAL_VAR(...)`, and `rlm_call(...)`
- Added a shared host-side webR package cache at `/tmp/pi-webr-package-cache`
- Fixed webR session setup to use `evalRVoid(...)` so setup code can safely return `NULL`
- Hardened base-R JSON signaling/escaping used by recursive webR RLM helpers
- Added `npm run validate:rlm:spark` for focused spark-based end-to-end RLM validation
- Surfaced `duration_ms` in completed top-level RLM output

## 0.1.0

- Initial release
- Bundled `subagent` extension derived from pi's subagent example
- Packaged default agents: scout, planner, worker, reviewer
- Added orchestration skills and prompt templates
