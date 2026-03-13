import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/publicUtils.ts'],
  outDir: 'dist',
  format: ['esm'],
  tsconfig: './tsconfig.json',
  target: 'es2018',
  minify: false,
  clean: true,
  dts: true,
})
