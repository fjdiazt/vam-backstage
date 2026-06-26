# Repository Guidelines

## Project Structure & Module Organization

VaM Backstage is an Electron desktop app for managing Virt-a-Mate `.var` packages.

- `src/main/`: Electron main process, SQLite persistence, scanners, Hub client, downloads, IPC handlers, updater, and VaM sidecar file logic.
- `src/preload/`: `contextBridge` API exposed to the renderer.
- `src/renderer/src/`: React 19 UI. Views live in `views/`, reusable components in `components/`, Zustand stores in `stores/`, hooks in `hooks/`, and shared renderer helpers in `lib/`.
- `src/shared/`: JavaScript modules reused by main and renderer, with nearby `*.test.js` files.
- `docs/`: architecture notes, API notes, and screenshots.
- `resources/` and `build/`: application icons and packaging resources.

## Build, Test, and Development Commands

- `npm install`: install dependencies and Electron native app deps.
- `npm run dev`: start Electron/Vite development mode.
- `npm run start`: preview the built Electron app.
- `npm run build`: build main, preload, and renderer bundles.
- `npm run build:win`, `npm run build:mac`, `npm run build:linux`: package for a target OS.
- `npm run lint`: run ESLint over the repository.
- `npm run format:check`: verify Prettier formatting.
- `npm run test`: run Vitest through Electron with `ELECTRON_RUN_AS_NODE=1`.

## Coding Style & Naming Conventions

Use JavaScript only; this repo has no TypeScript. Follow `.editorconfig`: UTF-8, LF endings, 2-space indentation, final newline. Prettier uses single quotes, no semicolons, `printWidth: 120`, and trailing commas. CSS uses 4-space tabs through the Prettier override.

Use `PascalCase.jsx` for React components, `use*.js` for hooks and Zustand stores, and kebab-case or descriptive lowercase filenames for main/shared modules. Prefer existing aliases from `vitest.config.mjs`: `@` for `src/renderer/src` and `@shared` for `src/shared`.

## Testing Guidelines

Vitest includes `src/**/*.test.js`. Keep tests close to the module they cover, as in `src/main/store.test.js` or `src/renderer/src/lib/semver.test.js`. Add or update focused tests for scanner, database, IPC-adjacent utility, and shared parsing changes. Run `npm run test` before pushing.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, for example `fix search clear` and `support like button`. Keep subjects concise and behavior-focused.

Before opening a PR, run `npm run lint`, `npm run format:check`, `npm run test`, and `npm run build`. PRs should describe the user-visible change, note scanner/database or packaging impact, link issues when available, and include screenshots for renderer UI changes.

This checkout is a fork workflow:

- `origin` is `https://github.com/fjdiazt/vam-backstage.git`.
- `upstream` is `https://github.com/cyberpunk2073/vam-backstage.git` and should be fetch-only.
- Keep `master` clean as the upstream mirror/protected branch. Do not merge local-only feature work there unless upstream accepted it.
- Use one `feature/*` branch per upstream PR. Branch from `master` or `upstream/master` when possible.
- Open PRs against `cyberpunk2073/vam-backstage:master` from the feature branch.
- After opening the upstream PR, merge the feature branch into `develop` and push `origin/develop` so the fork can use the feature immediately.
- Use `develop` only as the local integration branch. Do not use it as an upstream PR source unless the PR intentionally includes every unmerged feature already on `develop`.
- When upstream accepts a feature, sync `master` from `upstream/master`, then refresh `develop` as needed.

## Security & Configuration Tips

Do not commit local VaM paths, downloaded `.var` files, databases, credentials, or release tokens. Destructive developer actions such as database nuking must stay gated behind existing dev-option checks.
