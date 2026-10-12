# Vendored Claude Code provider

Upstream: https://github.com/earendil-works/pi-claude-code  
Revision: `0065a1f5a5e1f2214c87dcf2cdf7d66180b79459`  
License: MIT, copyright 2026 Armin Ronacher; see [LICENSE](LICENSE).

This generated snapshot includes upstream source, tests, documentation, and its
locked development dependencies. The [manifest](../../scripts/vendor/pi-claude-code/manifest.json)
pins the Git archive SHA-256 and each upstream file. Upstream [README](README.md)
and [architecture](ARCHITECTURE.md) describe the provider; local installation and
verification are governed by [operating notes](../../docs/operations.md#claude-code-subscription)
and the [testing playbook](../../EXTENSION_TESTING_PLAYBOOK.md#claude-code-vendor).

## Patch and overlay ownership

[0001-host-model-catalog.patch](../../scripts/vendor/pi-claude-code/patches/0001-host-model-catalog.patch)
uses Pi's host-mapped `providers/all` entry point. The generated
`providers/anthropic.models` subpath is not mapped by the extension loader in a
clean package installation, even when it exists inside the host distribution.
The patch preserves upstream Anthropic model metadata and native routing.

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
