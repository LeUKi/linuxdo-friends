# Firefox AMO Build

This project submits Firefox packages to AMO manually. GitHub Actions builds the unsigned Firefox submission zip, but it does not sign, upload, or update AMO.

## Environment

- Reference operating system: macOS 15 (Darwin 24) arm64; the same commands run in the GitHub Actions `ubuntu-latest` environment
- Node.js 22.20.0
- npm 10.9.3
- Source checkout at the exact release tag, for example `v1.5.2`
- Dependencies installed from the committed `package-lock.json`; no global npm packages are required

## Build

```bash
npm ci
npm test
npm run typecheck
npm run build:firefox
npm run lint:firefox
npm run package:firefox -- --name linuxdo-friends-v1.5.2-firefox.zip
```

The Firefox package is written to `packages/linuxdo-friends-v1.5.2-firefox.zip`. Its root contains `manifest.json`.

The build compiles TypeScript and React with Vite, then packages `dist-firefox/` with the repository-pinned `web-ext@10.6.0`. Source maps are intentionally included. The extension does not download or execute remote code during the build or at runtime.

## AMO Submission

In AMO:

- Upload `packages/linuxdo-friends-v1.5.2-firefox.zip` as the extension package.
- Upload GitHub's automatic `Source code (zip)` from the same release tag as the source archive.

The Firefox Release ZIP is the unsigned package submitted for AMO review. The installable public Firefox artifact is produced by AMO after signing.

Do not upload `firefox-source.zip`; this repository relies on the same-tag GitHub source archive.
