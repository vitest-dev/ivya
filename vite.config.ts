import { defineConfig } from 'vite-plus'

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  pack: {
    entry: ['src/index.ts', 'src/publicUtils.ts', 'src/aria/index.ts'],
    outDir: 'dist',
    format: ['esm'],
    fixedExtension: false,
    tsconfig: './tsconfig.json',
    target: 'es2018',
    minify: false,
    clean: true,
    dts: true,
  },
  fmt: {
    semi: false,
    trailingComma: 'es5',
    singleQuote: true,
    bracketSameLine: true,
    tabWidth: 2,
    printWidth: 85,
    ignorePatterns: [],
  },
})
