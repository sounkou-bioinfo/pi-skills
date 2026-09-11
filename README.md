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

| Capability                                                           | Entry points / source                                                                                                                                |
|----------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| Background shell tasks and task dock                                 | `bg_run`, `bg_status`, `bg_logs`, `bg_kill`; [manager](vendor/pi-background-tasks/UPSTREAM.md)                                                       |
| Long-context analysis with JavaScript and system R                   | [rlm](extensions/rlm)                                                                                                                                |
| Project/global notes, scoped history, and recall                     | [memory](docs/memory.md)                                                                                                                             |
| Explicit goals, human-input pauses, and continuation                 | [/goals](extensions/goals); `request_human_input`                                                                                                    |
| Plain-language task cards, approval/start, and trace-linked evidence | [/workbench](docs/workbench.md); `propose_contract`, `record_checkpoint`                                                                             |
| R-native coding style                                                | [We Use R Damnit](skills/we-use-r-damnit/SKILL.md)                                                                                                   |
| R/C structural review; optional Jarl lint                            | [anti_slop](skills/r-c-anti-slop/SKILL.md)                                                                                                           |
| Web and biomedical evidence search                                   | [web_search](extensions/codex-web-search), [biomedical_search](extensions/biomedical-evidence)                                                       |
| Completion batching and bounded inspection context                   | [completions](extensions/completions), [context-budget](extensions/context-budget)                                                                   |
| Mandatory artifact and tool discipline                               | [no-ghosts](skills/no-ghosts/SKILL.md), [native-tool-discipline](skills/native-tool-discipline/SKILL.md), [prompt hook](extensions/mandatory-skills) |
| Decision-review instructions and SSH-safe path clicks                | [expert-discipline](extensions/expert-discipline), [vscode-path-links](extensions/vscode-path-links)                                                 |

Browse [skills](skills/) for R packages, native bindings, genomics, and
project workflows, including [orientation after a handoff or conflicting
evidence](skills/project-orientation/SKILL.md).
[package.json](package.json) declares the loaded extensions and skills.

Keep `completions` enabled alongside background tasks and RLM. Reading a
terminal result suppresses its pending notice; unread notices are
batched when Pi is idle. See [operating notes](docs/operations.md) for
silent polling, limits, and storage.

## Development

``` sh
npm install
npm run check
```

This is the full local gate: typechecking, current tests, package/docs
checks, and README consistency—not an exhaustive integration
certification. Use the playbook’s change-scoped checks during editing.

- [QA standard](EXTENSION_QA_STANDARD.md): requirements for changes.
- [Testing playbook](EXTENSION_TESTING_PLAYBOOK.md): commands,
  isolation, and test layers.
- [Coverage and gaps](TEST_PLAN.md): what is actually exercised.
- [Changelog](CHANGELOG.md).

## License

MIT for first-party code; the vendored background manager is
[ISC-licensed](vendor/pi-background-tasks/LICENSE).
