# Vendored background tasks

Source: npm `pi-background-tasks@0.6.0`
Upstream: https://github.com/ismailsaleekh/pi-background-tasks
License: ISC (see LICENSE)

This repository owns this snapshot; do not install a second standalone copy.
Update through pi-skills, preserving upstream attribution and reviewing local changes.

Local changes:
- Recreate the runtime output directory after cleanup (formerly a postinstall patch).
- Classify signal termination as failure, never successful completion.
- Route notifications and observations through the session-owned completion queue.
- Disable the standalone upstream update check/advice.

The repository background-task and completion tests cover local behavior. The npm
snapshot does not include upstream's test sources; its documented test commands
are upstream references, not claims that those suites ran here. The copied README,
testing and publishing documents are labeled accordingly; their original parent
workspace links are retained as historical text.

Local policy: [QA standard](../../EXTENSION_QA_STANDARD.md),
[testing playbook](../../EXTENSION_TESTING_PLAYBOOK.md), and
[coverage matrix](../../TEST_PLAN.md).
