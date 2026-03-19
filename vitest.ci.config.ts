import { mergeConfig } from 'vitest/config'
import baseConfig from './vitest.config'

export default mergeConfig(baseConfig, {
  test: {
    browser: {
      instances: [
        {
          browser: 'firefox',
        },
        {
          browser: 'webkit',
        },
      ],
    },
  },
})
