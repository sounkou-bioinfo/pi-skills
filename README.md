# pi-skills

<!-- README.md is generated from README.Rmd. Edit README.Rmd and run `npm run render:readme`. -->

Pi extensions and skills for R, native code, DuckDB, and bioinformatics.

## Install

``` sh
pi install git:github.com/sounkou-bioinfo/pi-skills
```

To update an existing installation:

``` sh
pi update git:github.com/sounkou-bioinfo/pi-skills
```

After live tasks finish, run `/reload` in Pi. Reloading alone does not
fetch updates or install dependencies. Extensions run with your system
permissions.

R evaluation and the R/C audit require system R; the audit also needs
Tree-sitter grammars. See [runtime requirements and
configuration](docs/operations.md).

## Included

| Capability                                            | Entry points / source                                                                                |
|-------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| Background shell tasks and task dock                  | `bg_run`, `bg_status`, `bg_logs`, `bg_kill`; [manager](vendor/pi-background-tasks/UPSTREAM.md)       |
| Long-context analysis with JavaScript and system R    | [rlm](extensions/rlm)                                                                                |
| Persistent notes, historical queries, and recall      | [memory](extensions/memory)                                                                          |
| Explicit goals and continuation                       | [/goals](extensions/goals)                                                                           |
| R/C structural review; optional Jarl lint             | [anti_slop](skills/r-c-anti-slop/SKILL.md)                                                           |
| Web and biomedical evidence search                    | [web_search](extensions/codex-web-search), [biomedical_search](extensions/biomedical-evidence)       |
| Completion batching and bounded inspection context    | [completions](extensions/completions), [context-budget](extensions/context-budget)                   |
| Decision-review instructions and SSH-safe path clicks | [expert-discipline](extensions/expert-discipline), [vscode-path-links](extensions/vscode-path-links) |

Browse [skills](skills/) for R packages, native bindings, genomics, and
project workflows. [package.json](package.json) declares the loaded
extensions and skills.

Keep `completions` enabled alongside background tasks and RLM. Reading a
terminal result suppresses its pending notice; unread notices are
batched when Pi is idle. See [operating notes](docs/operations.md) for
silent polling, limits, and storage.

## Development

``` sh
npm install
npm run check
```

The check runs typechecking, the current test suite, package/docs
checks, and README consistency. It is **not** an exhaustive integration
certification.

- [QA standard](EXTENSION_QA_STANDARD.md): requirements for changes.
- [Testing playbook](EXTENSION_TESTING_PLAYBOOK.md): commands,
  isolation, and test layers.
- [Coverage and gaps](TEST_PLAN.md): what is actually exercised.
- [Changelog](CHANGELOG.md).

## License

MIT for first-party code; the vendored background manager is
[ISC-licensed](vendor/pi-background-tasks/LICENSE).
