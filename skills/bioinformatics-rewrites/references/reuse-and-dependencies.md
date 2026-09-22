# Reuse and dependencies

## Design questions

Ask early:

- What mature library already does the core hard work?
- Can the innovation happen in composition rather than full reimplementation?
- Should this become a library/API/extension/UDF instead of just a binary?
- Which runtimes have real consumers: CLI, R, Python, SQL, wasm?
- Which packaging ecosystems matter: CRAN, HPC, containers, offline installs?

A useful rewrite often multiplies access to existing robust code.

## Dependency cost

Dependency choice is an architectural decision. Each dependency adds:

- vendoring and auditing burden;
- CRAN packaging difficulty;
- binary size;
- transitive breakage risk;
- wasm/HPC/offline deployment friction.

Before adding one, ask:

- Is the capability already available in existing trusted libraries?
- Is this dependency essential or merely convenient?
- Can it be vendored and audited sanely?
- Does it fit the target deployment environments?

Prefer fewer, better-understood dependencies over novelty for its own sake.
