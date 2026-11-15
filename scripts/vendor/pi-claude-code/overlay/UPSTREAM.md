# Vendored Claude Code provider

Upstream: https://github.com/earendil-works/pi-claude-code  
Revision: `d5b5e04c314d3452d357174d16d10dda34daa2d2`  
License: MIT, copyright 2026 Armin Ronacher; see [LICENSE](LICENSE).

This generated snapshot includes upstream source, tests, documentation, and its
locked development dependencies. The [manifest](../../scripts/vendor/pi-claude-code/manifest.json)
pins the Git archive SHA-256 and each upstream file. Upstream [README](README.md)
and [architecture](ARCHITECTURE.md) describe the provider; local installation and
verification are governed by [operating notes](../../docs/operations.md#claude-code-subscription)
and the [testing playbook](../../EXTENSION_TESTING_PLAYBOOK.md#claude-code-vendor).

## Patch and overlay ownership

[0001-normalize-tool-call-ids.patch](../../scripts/vendor/pi-claude-code/patches/0001-normalize-tool-call-ids.patch)
hashes incompatible or overlong historical tool-call identifiers to stable
64-character Claude-compatible identifiers and applies the same mapping to
linked tool results. Upstream's cross-provider normalization replaces invalid
characters and truncates, so two foreign identifiers sharing their first 64
characters would collide; the patch uses the hash there too. Stored Pi messages
are not changed.

[0002-cache-request-boundary.patch](../../scripts/vendor/pi-claude-code/patches/0002-cache-request-boundary.patch)
budgets four explicit cache markers across tools, the leading system prompt,
and replay messages. Markers Claude Code places on other messages are removed;
the previous queried user message and the final message carry the two message
markers, so the request never exceeds Anthropic's four-breakpoint limit. It exposes the rewritten JSON to Pi's asynchronous payload
hook before forwarding; hook rejection or cancellation prevents forwarding.
Loopback CLI/HTTP fixtures cover the composed request, process reuse, and hook
mutation/replacement without live subscription calls.

[0003-stable-initial-reminders.patch](../../scripts/vendor/pi-claude-code/patches/0003-stable-initial-reminders.patch)
places native environment/date reminders in their replay positions on the first
request. Cleanup preserves the initial reminder block and matches complete text
boundaries. Fixtures compare message prefixes through tool-worker replacement,
warm continuation, and the loopback HTTP boundary independently of cache-marker
movement.

[0004-claude-accounts.patch](../../scripts/vendor/pi-claude-code/patches/0004-claude-accounts.patch)
adds `/claude-account` for named Claude Code logins. Each account is an absolute
Claude Code config directory; the selection in `claude-code-accounts.json` under
the Pi agent directory overrides `PI_CLAUDE_CODE_CONFIG_DIR` for the next request,
model discovery, and `/claude-code-status`. Each read uses the file's current
contents, and updates take a cross-process lock. `default` restores the configured
login. The process fingerprint includes the environment, so a switch starts a
new Claude Code worker instead of reusing one logged in to another account.

[0005-upstream-open-fixes.patch](../../scripts/vendor/pi-claude-code/patches/0005-upstream-open-fixes.patch)
carries open upstream pull requests
[#51](https://github.com/earendil-works/pi-claude-code/pull/51) at `5e7b25e`,
[#39](https://github.com/earendil-works/pi-claude-code/pull/39) at `731542f`, and
[#56](https://github.com/earendil-works/pi-claude-code/pull/56) at `b21cab8`.
Replayed same-model assistant frames carry the model that answered, so Claude
Code keeps their signed thinking instead of re-reasoning each step
([#52](https://github.com/earendil-works/pi-claude-code/issues/52)); after a
model switch, thinking is dropped before tagging. As in pi-ai, aborted and
errored assistant turns are skipped, and retained tool calls without results
receive an error result before replay
([#49](https://github.com/earendil-works/pi-claude-code/issues/49)). An
`api_error` or `overloaded_error` event inside a 200 stream is retryable. Drop
this patch when upstream merges or supersedes those pull requests.

Upstream covers host-mapped model-catalog imports, signed-thinking provenance,
and rebuilding user messages from Pi history without native startup reminders.

This provenance file comes from the [overlay](../../scripts/vendor/pi-claude-code/overlay/UPSTREAM.md).
Edit the manifest, ordered patches, or overlay inputs, not generated files under
`vendor/pi-claude-code/`. There are no install-time patches or downloads.

## Refresh and verification

From the pi-skills root, with an upstream Git checkout containing the pinned revision:

```sh
npm run vendor:claude-code -- --source /path/to/pi-claude-code
npm run check:claude-code-vendor
npm run test:claude-code
npm run check
```

Generation reads the pinned Git object, not working-tree changes or installed
`node_modules`. It verifies the archive and upstream file hashes, applies patches
in manifest order, and copies overlay files. `check:claude-code-vendor` works
offline without an upstream checkout: it reverses the patches, verifies the
pristine file inventory/hashes, then replays the patches and overlay and compares
every generated file. An upstream bump requires updating the revision and hashes,
reviewing patches, and rerunning these gates.

The package loads `src/index.ts` directly through Pi. Load only one Claude Code
provider: remove or disable a standalone pi-claude-code package before reloading.
Claude Code owns authentication; live model/billing behavior is not certified by
local fixture tests. Preserve upstream's subscription warning and usage-credit
guard when refreshing this snapshot.
