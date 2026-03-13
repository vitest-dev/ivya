## Playwright source reference

When you need to reference Playwright source code (e.g. for ARIA snapshot implementation details), clone it locally:

```sh
git clone --depth 1 https://github.com/microsoft/playwright.git vendor/playwright
```

The `vendor/` directory is gitignored. For example, you can search for:
- `packages/playwright-core/src/server/injected/ariaSnapshot.ts` — ARIA snapshot logic
- `packages/playwright-core/src/server/injected/roleUtils.ts` — role/ARIA utilities
