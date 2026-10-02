import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launch } from './app'

const shots = (name: string) => join('test-results', 'screens', `${name}.png`)

async function jsonFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const year of await fs.readdir(dir).catch(() => [] as string[])) {
    for (const f of await fs.readdir(join(dir, year)).catch(() => [] as string[])) if (f.endsWith('.json')) out.push(join(dir, year, f))
  }
  return out.sort()
}

const readJson = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, any>

test('duplikowanie transakcji i kopiowanie planu dnia na inny dzień', async () => {
  const { app, page, dataDir, errors } = await launch()
  try {
    await expect(page.getByTestId('journal-table')).toBeVisible()
    const trades = () => jsonFiles(join(dataDir, 'trades'))
    const notes = async () => (await Promise.all((await trades()).map(readJson))).map((t) => t.notes).sort()

    await page.keyboard.press('Control+n')
    await expect(page.getByTestId('trade-editor')).toBeVisible()
    await page.getByTestId('price-entry').fill('1.0850')
    await page.getByTestId('price-sl').fill('1.0835')
    await page.getByTestId('trade-notes').fill('Sweep PDL → MSS')
    await expect.poll(notes, { timeout: 8000 }).toEqual(['Sweep PDL → MSS'])

    // Exact copy saved right away, then edited independently of the original.
    await page.getByTestId('duplicate-trade').click()
    await expect.poll(async () => (await trades()).length, { timeout: 8000 }).toBe(2)
    const [a, b] = await Promise.all((await trades()).map(readJson))
    expect(a!.id).not.toBe(b!.id)
    expect(a!.prices).toEqual(b!.prices)
    await expect(page.getByTestId('trade-notes')).toHaveValue('Sweep PDL → MSS')
    await page.getByTestId('trade-notes').fill('Re-entry po BE')
    await expect.poll(notes, { timeout: 8000 }).toEqual(['Re-entry po BE', 'Sweep PDL → MSS'])
    await page.screenshot({ path: shots('41-duplikat-transakcji') })

    // From the journal preview.
    await page.getByTestId('nav-journal').click()
    await expect(page.getByTestId('journal-row')).toHaveCount(2)
    await page.getByTestId('duplicate-selected').click()
    await expect(page.getByTestId('trade-editor')).toBeVisible()
    await expect.poll(async () => (await trades()).length, { timeout: 8000 }).toBe(3)

    // Day plan: the analysis goes to the next trading day, news and the review stay.
    await page.keyboard.press('Control+d')
    await expect(page.getByTestId('day-plan')).toBeVisible()
    const date = await page.getByTestId('day-date').inputValue()
    await page.getByTestId('scenario-primary').fill('Sweep Asia low → MSS M15 → long')
    await page.getByTestId('add-news').click()
    await page.getByTestId('news-title').fill('CPI')
    await page.getByTestId('day-review').fill('Scenariusz główny zrealizowany')
    const sourceFile = join(dataDir, 'days', date.slice(0, 4), `${date}.json`)
    await expect.poll(async () => (await readJson(sourceFile).catch(() => ({}) as Record<string, any>)).review?.whatHappened, { timeout: 8000 }).toBe('Scenariusz główny zrealizowany')

    await page.getByTestId('copy-plan').click()
    const target = await page.getByTestId('copy-plan-date').inputValue()
    expect(target > date).toBe(true)
    await page.getByTestId('copy-plan-confirm').click()
    await expect(page.getByTestId('day-date')).toHaveValue(target)
    await expect(page.getByTestId('scenario-primary')).toHaveValue('Sweep Asia low → MSS M15 → long')
    await expect(page.getByTestId('day-review')).toHaveValue('')
    const targetFile = join(dataDir, 'days', target.slice(0, 4), `${target}.json`)
    await expect.poll(async () => (await readJson(targetFile).catch(() => ({}) as Record<string, any>)).pairs?.[0]?.scenarioPrimary, { timeout: 8000 }).toBe(
      'Sweep Asia low → MSS M15 → long'
    )
    const copied = await readJson(targetFile)
    expect(copied.news).toEqual([])
    expect(copied.id).not.toBe((await readJson(sourceFile)).id)
    await page.screenshot({ path: shots('42-kopia-planu') })

    // Copying again onto a day that already has a plan changes nothing.
    await page.getByTestId('day-date').fill(date)
    await page.getByTestId('day-date').press('Enter')
    await expect(page.getByTestId('day-date')).toHaveValue(date)
    await page.getByTestId('copy-plan').click()
    await page.getByTestId('copy-plan-date').fill(target)
    await page.getByTestId('copy-plan-confirm').click()
    await expect(page.getByText(`Plan na ${target} już istnieje`)).toBeVisible()
    expect((await readJson(targetFile)).id).toBe(copied.id)
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
