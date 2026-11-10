/**
 * Captures the documentation screenshots into docs/screenshots/.
 * Run on a machine with a GPU:  SHOTS=1 npx playwright test e2e/screenshots.spec.ts
 */
import { expect, test } from '@playwright/test'

const SHOTS: { file: string; hash: string }[] = [
  { file: '01-overview-isometric.png', hash: '#m=iso' },
  { file: '02-main-building.png', hash: '#m=orbit&c=285,-130,2.7,1.05,330' },
  { file: '03-centennial-campus.png', hash: '#m=orbit&c=-40,-60,2.9,1.0,360' },
  { file: '04-campus-from-the-harbour-side.png', hash: '#m=orbit&c=150,-40,3.3,1.2,900' },
  { file: '05-eliot-and-may-hall.png', hash: '#m=orbit&c=470,20,3.6,1.1,220' },
  { file: '06-street-level-main-building.png', hash: '#m=explore&c=286,71,-232,3.14,0.12' },
  { file: '07-night.png', hash: '#m=orbit&c=285,-130,2.7,1.05,360&t=night' },
  { file: '08-confidence-overlay.png', hash: '#m=iso&c=200,-40,2.64,0.82,620&l=1111111001' },
  { file: '09-campus-zones.png', hash: '#m=iso&l=1111111010' },
]

test.describe('documentation screenshots', () => {
  test.skip(!process.env.SHOTS, 'set SHOTS=1 to regenerate docs/screenshots')
  for (const s of SHOTS) {
    test(s.file, async ({ page }) => {
      await page.goto('/' + s.hash)
      const explore = page.getByRole('button', { name: 'Explore campus' })
      await expect(explore).toBeEnabled({ timeout: 90_000 })
      await explore.click()
      await expect.poll(() => page.evaluate(() => (window as any).__hku?.store.getState().loaded), { timeout: 120_000 }).toBe(true)
      await page.waitForTimeout(6000)
      await page.screenshot({ path: `docs/screenshots/${s.file}` })
    })
  }
})
