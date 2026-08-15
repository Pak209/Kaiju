#!/usr/bin/env node
// Golden-render parity gate.
//
//   node tests/render/run.mjs            compare against the committed golden
//   node tests/render/run.mjs --update   re-render and REPLACE the golden
//
// What a pass proves: the bundle, converted through the app's own
// unityToThree and rendered from the fixed hero camera, still matches the
// committed image within tolerance — AND both known-bad modes (mirrored
// handedness, dropped rotations) still fail it. The second half is not
// decoration: an all-green gate whose known-bad also passes is blind, and
// the blindness is treated as the failure.
//
// Thresholds were measured, not guessed (2026-08-15, macOS Metal, 24.7%
// content in frame):
//   good   vs golden   0.00% of pixels differ (same machine)
//   mirror vs golden  14.25%
//   norot  vs golden   6.25%
// An earlier fixture put norot at 2.23% and this gate CORRECTLY refused to
// certify itself — the fix was more rotated asymmetry in the fixture (45-deg
// cubes read corner-on; 90-deg would be invisible), never a lower floor.
// PASS <= 2.0%; each known-bad must exceed 2x that. Margins are wide because
// a flaky gate gets deleted, and a deleted gate catches nothing.

import { createServer } from 'vite'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const GOLDEN = join(ROOT, 'fixtures', 'goldens', 'render', 'hero.png')
const OUT = join(ROOT, 'tests', 'render', 'out')
const update = process.argv.includes('--update')

const PASS_PCT = 2.0
const BAD_MIN_PCT = PASS_PCT * 2

mkdirSync(OUT, { recursive: true })
mkdirSync(dirname(GOLDEN), { recursive: true })

// Vite dev server gives the harness the same module graph as the app —
// src/core.ts is imported, not copied. /bundle/* is mapped onto the
// synthetic fixture bundle.
const vite = await createServer({
  root: ROOT,
  server: { port: 0 },
  logLevel: 'silent',
})
vite.middlewares.stack.unshift({
  route: '/bundle',
  handle: (req, res, next) => {
    try {
      const p = join(ROOT, 'fixtures', 'bundle', decodeURIComponent(req.url.split('?')[0]))
      res.setHeader('Content-Type', p.endsWith('.json') ? 'application/json' : 'application/octet-stream')
      res.end(readFileSync(p))
    } catch {
      next()
    }
  },
})
await vite.listen()
const port = vite.httpServer.address().port

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] })
const failures = []

async function render(mode) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => failures.push(`harness pageerror (${mode}): ${e.message}`))
  await page.goto(`http://localhost:${port}/tests/render/harness.html`, { waitUntil: 'networkidle0' })
  const dataUrl = await page.evaluate((m) => window.renderBundle(m), mode)
  await page.close()
  const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1], 'base64'))
  writeFileSync(join(OUT, `${mode}.png`), PNG.sync.write(png))
  return png
}

function diffPct(a, b, tag) {
  if (a.width !== b.width || a.height !== b.height) return 100
  const d = new PNG({ width: a.width, height: a.height })
  const n = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: 0.15 })
  writeFileSync(join(OUT, `diff-${tag}.png`), PNG.sync.write(d))
  return (100 * n) / (a.width * a.height)
}

try {
  const good = await render('good')

  // A gate that measures an empty frame passes forever. Refuse to certify a
  // render in which almost nothing was drawn — a broken loader or a camera
  // pointed at nothing must fail here, not pass as "matches the golden".
  const bg = { r: 0x20, g: 0x28, b: 0x30 }
  let content = 0
  for (let i = 0; i < good.data.length; i += 4)
    if (Math.abs(good.data[i] - bg.r) + Math.abs(good.data[i + 1] - bg.g) + Math.abs(good.data[i + 2] - bg.b) > 12) content++
  const contentPct = (100 * content) / (good.width * good.height)
  if (contentPct < 5) failures.push(`only ${contentPct.toFixed(1)}% of the frame is content — the render is empty or the camera is lost; refusing to compare.`)

  if (update) {
    writeFileSync(GOLDEN, PNG.sync.write(good))
    console.log(`golden updated: ${GOLDEN} (${contentPct.toFixed(1)}% content)`)
  } else if (!existsSync(GOLDEN)) {
    failures.push(`no golden at ${GOLDEN} — run with --update once, eyeball the image, and commit it.`)
  } else if (failures.length === 0) {
    const golden = PNG.sync.read(readFileSync(GOLDEN))
    const goodPct = diffPct(good, golden, 'good')
    const mirrorPct = diffPct(await render('mirror'), golden, 'mirror')
    const norotPct = diffPct(await render('norot'), golden, 'norot')

    console.log(`  good   vs golden: ${goodPct.toFixed(2)}%  (pass <= ${PASS_PCT}%)`)
    console.log(`  mirror vs golden: ${mirrorPct.toFixed(2)}%  (must be >= ${BAD_MIN_PCT}%)`)
    console.log(`  norot  vs golden: ${norotPct.toFixed(2)}%  (must be >= ${BAD_MIN_PCT}%)`)

    if (goodPct > PASS_PCT)
      failures.push(`RENDER DRIFT — good render differs from the golden by ${goodPct.toFixed(2)}% (> ${PASS_PCT}%). See tests/render/out/diff-good.png.`)
    if (mirrorPct < BAD_MIN_PCT)
      failures.push(`GATE IS BLIND — the mirrored-handedness known-bad only moved ${mirrorPct.toFixed(2)}% of pixels. The all-clear is the warning.`)
    if (norotPct < BAD_MIN_PCT)
      failures.push(`GATE IS BLIND — the dropped-rotations known-bad only moved ${norotPct.toFixed(2)}% of pixels. The all-clear is the warning.`)
  }
} finally {
  await browser.close()
  await vite.close()
}

if (failures.length) {
  console.error('\nRENDER GATE FAILED')
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log('render gate OK')
