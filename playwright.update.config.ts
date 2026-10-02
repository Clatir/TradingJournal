import { defineConfig } from '@playwright/test'

/** Windows CI only: real update of the packaged app (tests/update, see .github/workflows/ci.yml). */
export default defineConfig({
  testDir: 'tests/update',
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/update'
})
