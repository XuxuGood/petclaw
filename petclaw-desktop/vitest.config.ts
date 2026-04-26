import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environmentMatchGlobs: [
      ['tests/renderer/**', 'jsdom'],
      ['tests/main/**', 'node']
    ],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/renderer/index.html', 'src/renderer/pet.html', '**/*.d.ts']
    },
    alias: {
      electron: resolve('./tests/__mocks__/electron.ts')
    }
  }
})
