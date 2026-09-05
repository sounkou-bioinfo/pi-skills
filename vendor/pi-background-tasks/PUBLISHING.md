# Publishing pi-background-tasks

This package is ready for both npm publishing and standalone git publishing.

## Preconditions

- npm account with publish rights for `pi-background-tasks`.
- Standalone GitHub repository, expected: `github.com/ismailsaleekh/pi-background-tasks`.
- Clean worktree.

## Verify

```bash
cd packages/pi-background-tasks
npm run test
npm run test:full
npm run smoke
npm pack --dry-run
npm view pi-background-tasks name version --json
```

`pi-background-tasks` is already published; bump `package.json` before each npm publish.

## Publish to npm

```bash
cd packages/pi-background-tasks
npm login
npm publish --access public
```

Pi install smoke after publish:

```bash
pi -e npm:pi-background-tasks@0.6.0 --offline --no-tools --no-session -p "/jobs"
pi install npm:pi-background-tasks@0.6.0
```

## Publish to git

Because Pi git package installs treat the repository root as the package root, do not point Pi at the `ai-pipeline` monorepo root for this package. Push the contents of `packages/pi-background-tasks/` to a standalone repository.

```bash
cd packages/pi-background-tasks
git init
git add .
git commit -m "Release pi-background-tasks"
git branch -M main
git remote add origin git@github.com:ismailsaleekh/pi-background-tasks.git
git push -u origin main
git tag v0.6.0
git push origin v0.6.0
```

Pi install smoke after git tag:

```bash
pi -e git:github.com/ismailsaleekh/pi-background-tasks@v0.6.0 --offline --no-tools --no-session -p "/jobs"
pi install git:github.com/ismailsaleekh/pi-background-tasks@v0.6.0
```

## pi.dev/packages

The package includes the `pi-package` keyword and a `pi.extensions` manifest. After npm publish, it should be discoverable by pi.dev package indexing. If it does not appear automatically, submit/refresh the package according to the pi.dev package-gallery process.
