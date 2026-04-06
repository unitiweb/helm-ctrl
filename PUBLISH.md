# Publishing `helm-ctrl`

This document is the release runbook for publishing `helm-ctrl` to npm and creating a matching GitHub Release.

## Repo assumptions

- The primary branch is `develop`.
- PRs merge into `develop`.
- The npm package name is `helm-ctrl`.
- Tests run in GitHub Actions from `.github/workflows/test.yml`.
- Releases should be cut only from a clean, green commit on `develop`.

## Recommended release model

Use this flow:

1. Merge PRs into `develop`.
2. Wait for CI to pass.
3. Create a semver tag such as `v1.0.0`.
4. Let GitHub Actions publish the package to npm from that tag.
5. Create a GitHub Release from the same tag.

Why this is the preferred flow:

- Git history, npm, and GitHub Releases all point at the same version.
- Publishing happens in CI instead of from a local laptop.
- npm trusted publishing avoids storing a long-lived `NPM_TOKEN` in GitHub secrets.
- Tag-based publishing is easier to reason about than a manual button-driven process.

## One-time setup

### 1. Protect `develop`

In GitHub branch protection:

- Require pull requests before merging.
- Require status checks to pass before merging.
- Require the test workflow to pass.
- Restrict who can push directly if needed.

### 2. Configure npm trusted publishing

In npm:

1. Open the package settings for `helm-ctrl`.
2. Add a trusted publisher for GitHub Actions.
3. Use the repository `unitiweb/helm-ctrl`.
4. Enter the workflow filename `publish.yml`.

This is preferred over storing an npm token in GitHub secrets.

### 3. Add a publish workflow

The repo uses `.github/workflows/publish.yml`:

```yaml
name: Publish

on:
  push:
    tags:
      - "v*"

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: "https://registry.npmjs.org"

      - name: Use npm 11 for trusted publishing
        run: npm install -g npm@^11.5.1

      - name: Verify tag matches package version
        run: |
          tag_version="${GITHUB_REF_NAME#v}"
          package_version="$(node -p "require('./package.json').version")"

          if [ "$tag_version" != "$package_version" ]; then
            echo "Tag version $tag_version does not match package.json version $package_version"
            exit 1
          fi

      - name: Verify Node.js and npm versions
        run: |
          node --version
          npm --version

      - name: Install dependencies
        if: ${{ hashFiles('package-lock.json') != '' }}
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Publish to npm
        run: npm publish
```

Notes:

- `id-token: write` is required for npm trusted publishing.
- In the npm UI, enter only the workflow filename: `publish.yml`.
- For trusted publishing, npm generates provenance automatically for public packages from public repos.
- npm currently requires npm CLI `11.5.1+` and Node `22.14.0+` for trusted publishing.
- The workflow refuses to publish if the git tag and `package.json` version do not match.
- This repo currently does not have a `package-lock.json`, so the install step is skipped.
- If the package ever becomes scoped, change the publish command to `npm publish --access public`.
- If the repo later gains dependencies and a lockfile, the workflow will automatically use `npm ci`.

## Standard release checklist

Run this for every release.

### 1. Make sure `develop` is ready

Before tagging:

- All intended PRs are merged into `develop`.
- CI is green.
- `README.md` and package metadata are up to date.
- `npm pack --dry-run` looks correct.

Useful commands:

```bash
git checkout develop
git pull origin develop
npm test
npm pack --dry-run
```

### 2. Bump the version

For normal releases:

```bash
npm version patch
```

or:

```bash
npm version minor
```

or:

```bash
npm version major
```

What `npm version` does:

- Updates `package.json`
- Creates a git commit
- Creates a matching git tag such as `v1.0.1`

Important:

- The git tag and `package.json` version must always match.
- Do not hand-edit the version and then forget to tag it.

### 3. Push the release commit and tag

```bash
git push origin develop --follow-tags
```

That push should trigger the publish workflow if `.github/workflows/publish.yml` exists and npm trusted publishing is configured.

### 4. Verify the npm publish

After the GitHub Action completes:

- Confirm the workflow passed.
- Confirm the new version appears on npm.
- Confirm `npm view helm-ctrl version` returns the expected version.

Example:

```bash
npm view helm-ctrl version
```

### 5. Create the GitHub Release

After npm publish succeeds:

1. Open GitHub Releases.
2. Create a release from the existing tag.
3. Use the same version string as the tag, for example `v1.0.1`.
4. Use generated release notes, then edit for clarity.
5. Publish the release.

Recommended release note sections:

- Added
- Changed
- Fixed
- Breaking changes

## First `1.0.0` release

This repo already has `package.json` at `1.0.0`.

If the commit you want to ship already contains that version, do not run `npm version 1.0.0` again. Just tag that commit:

```bash
git checkout develop
git pull origin develop
npm test
npm pack --dry-run
git tag -a v1.0.0 -m "v1.0.0"
git push origin develop --follow-tags
```

Then:

1. Wait for the publish workflow to finish.
2. Verify `helm-ctrl@1.0.0` is live on npm.
3. Create the GitHub Release from tag `v1.0.0`.

## Manual fallback publish

If the publish workflow is not set up yet, publish manually from your machine:

```bash
git checkout develop
git pull origin develop
npm test
npm pack --dry-run
npm login
npm whoami
npm publish
git tag -a v1.0.0 -m "v1.0.0"
git push origin develop --follow-tags
```

Manual publishing is acceptable for an early release, but it should be treated as a fallback, not the long-term process.

## Guardrails

- Never publish from a dirty working tree.
- Never publish without running `npm pack --dry-run`.
- Only publish versions that have a matching git tag.
- Prefer fixing forward with `1.0.1`, `1.0.2`, and so on instead of trying to reuse a version.
- Keep the `files` list in `package.json` restrictive so only intended files ship to npm.
- Do not create the GitHub Release until the npm publish has succeeded.

## References

- GitHub Actions package publishing: https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages
- npm trusted publishers: https://docs.npmjs.com/trusted-publishers/
- npm publishing public packages: https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/
