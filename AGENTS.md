# Repository Guidelines

## Project Structure & Module Organization

`bin/nnresume.js` is the public CLI entry point. Keep reusable Node logic in `lib/`; `server.js` serves the localhost editor and API. Browser behavior lives in `editor.js`, while `resume-renderer.js` loads renderers from `templates/<id>/`.

`starter/` is copied into new user workspaces and `examples/demo/` contains synthetic development data. A user workspace owns its own `resume.json`, `assets/`, Git repository, and ignored `exports/`; never place real resume data in the product repository. Tests live in `test/*.test.js`, with browser coverage in `scripts/e2e.js`.

## Build, Test, and Development Commands

- `npm ci` installs locked dependencies.
- `npx playwright install chromium` installs the export/E2E browser.
- `npm run dev` starts the editor against `examples/demo`.
- `npm run check` checks project JavaScript syntax.
- `npm test` runs the `node:test` suite.
- `npm run test:e2e` exercises the editor and template workflow in Chromium.
- `npm run pack:check` audits the npm tarball for private or unintended files.
- `npx nnresume init my-resume` exercises the public initialization flow.

## Coding Style & Naming Conventions

Use CommonJS, two-space indentation, semicolons, and double quotes. Prefer `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for constants, and kebab-case template IDs and export labels. Keep filesystem, Git, template registry, and export operations in `lib/`; validate all input before writing or invoking external commands.

## Testing Guidelines

Use `node:test` with `node:assert/strict`. Name files `test/<module>.test.js` and tests by behavior. Use temporary directories and local bare repositories for filesystem/Git tests. Every behavior change needs a focused regression test. Run `npm run check && npm test && npm run pack:check`; run E2E for editor, preview, template, or export changes.

## Commit & Pull Request Guidelines

Use concise Conventional Commit prefixes such as `feat:`, `fix:`, `style:`, and `chore:`. Keep commits scoped and imperative. Pull requests should explain user-visible impact, list verification commands, link relevant issues, and include screenshots for editor or resume-layout changes.

## Security & Privacy

The public repository and npm package must contain only synthetic resume fixtures. Never commit real `resume.json` files, profile photos, generated exports, screenshots containing personal content, credentials, or migration backups. Keep the server bound to `127.0.0.1`. Preserve path allowlists, request-size limits, schema/template validation, scoped Git staging, fast-forward-only pull behavior, npm `files` allowlists, and package privacy audits.
