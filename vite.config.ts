import tsdownConfig from './tsdown.config.js';

import { defineConfig } from 'vite-plus';

export default defineConfig({
  staged: {
    "*": "vp check --fix"
  },
  pack: tsdownConfig,
  lint: {"options":{"typeAware":true,"typeCheck":true}},
  fmt: {
    "semi": false,
    "trailingComma": "es5",
    "singleQuote": true,
    "bracketSameLine": true,
    "tabWidth": 2,
    "printWidth": 85,
    "ignorePatterns": []
  },
});
