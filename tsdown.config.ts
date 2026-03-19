import { defineConfig } from 'vite-plus/pack'

export default defineConfig({
  entry: ['src/index.ts', 'src/publicUtils.ts', 'src/aria/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  fixedExtension: false,
  tsconfig: './tsconfig.json',
  target: 'es2018',
  minify: false,
  clean: true,
  dts: true,
})
