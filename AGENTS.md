## Playwright source reference

When you need to reference Playwright source code (e.g. for ARIA snapshot implementation details), clone it locally:

```sh
git clone --depth 1 https://github.com/microsoft/playwright.git vendor/playwright
```

The `vendor/` directory is gitignored. For example, you can search for:

- `packages/playwright-core/src/server/injected/ariaSnapshot.ts` — ARIA snapshot logic
- `packages/playwright-core/src/server/injected/roleUtils.ts` — role/ARIA utilities

## Upstream divergences

Files under `src/aria/folk/` are derived from Playwright. When making intentional changes that differ from upstream, mark the site with:

```ts
// DIVERGENCE(playwright): <reason>
```

To list all divergences:

```sh
grep -rn 'DIVERGENCE(playwright)' src/aria/folk/
```

When syncing upstream or considering filing issues, review this list. If a divergence has a clear user-facing edge case, consider upstreaming to Playwright.

## Tests

- Iterate on aria snapshot utility feature

```sh
pnpm test-chrome test/aria.test.ts --browser.headless --update
```
