# Plannotator provenance

- Project: https://github.com/backnotprop/plannotator
- Package: `@plannotator/pi-extension` **0.27.14**, pinned and bundled by this package.
- npm integrity: `sha512-F/b7zaNm33TIve0Qct5mdVUzyM2UxbmL12R9hQNAznbO99O0odeCx7/zQf7e7bGmSGl3nu/OKP0IY+uRSVmsog==`.
- npm provenance identifies tag `v0.27.14`, commit
  `421c6af4cde06e8c12e75b3c6a86e6765f469009`.
- License: [MIT](LICENSE-MIT) OR [Apache-2.0](LICENSE-APACHE). License texts are
  retained from that upstream commit; third-party dependency notices remain in
  the bundled packages.

Pi loads upstream's TypeScript entry through `upstream.js`. First-party code
sets loopback/private-review defaults, requires an interactive plan-review surface
with browser assets, and adds local-review instructions. The
plan state machine, review UI, annotations, and review persistence belong to
upstream Plannotator. The shipped Pi package needs no separate Plannotator CLI.

The published extension and its browser assets are tested together. Updating the
pin requires source-loaded SDK, browser/SSH-forwarding, and packed-runtime checks;
the GitHub `main` branch is not the versioned npm runtime.
