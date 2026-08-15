#!/usr/bin/env node
// unity/Editor/ is CANONICAL. HolobotsUnity/Assets/Holobots/Shared/Editor/ is a copy.
//
// Why a copy and not a submodule: Unity's AssetDatabase wants real files under
// Assets/ with .meta siblings it owns, and a submodule there fights the
// importer for control of those .meta files. A copy plus a drift check is
// duller and does not lose GUIDs.
//
//   npm run sync:unity            write canonical -> Unity project
//   npm run sync:unity -- --check exit 1 if they differ (CI / pre-PR)
//
// The Unity project path comes from $KAIJU_UNITY_PROJECT, else ../HolobotsUnity.
// When it is absent (a CI runner, an agent without the Unity repo) --check is
// a documented SKIP, never a silent pass: the message says which it was.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CANONICAL = join(ROOT, 'unity', 'Editor')

const unityProject = resolve(
  process.env.KAIJU_UNITY_PROJECT || join(ROOT, '..', 'HolobotsUnity'),
)
const TARGET = join(unityProject, 'Assets', 'Holobots', 'Shared', 'Editor')

const checkOnly = process.argv.includes('--check')
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12)

if (!existsSync(unityProject)) {
  const msg =
    `SKIPPED — Unity project not found at ${unityProject}.\n` +
    `  Set KAIJU_UNITY_PROJECT to check drift. This is a skip, not a pass:\n` +
    `  nothing was compared and nothing was written.`
  console.log(msg)
  process.exit(0)
}

const files = readdirSync(CANONICAL).filter((f) => f.endsWith('.cs'))
if (files.length === 0) {
  console.error(`no .cs files in ${CANONICAL}`)
  process.exit(1)
}

const drifted = []
const written = []

for (const f of files) {
  const src = readFileSync(join(CANONICAL, f))
  const dstPath = join(TARGET, f)
  const dst = existsSync(dstPath) ? readFileSync(dstPath) : null

  if (dst !== null && src.equals(dst)) continue

  if (checkOnly) {
    drifted.push(
      dst === null
        ? `${f}: missing from the Unity project`
        : `${f}: differs — canonical ${sha(src)}, Unity ${sha(dst)}`,
    )
  } else {
    mkdirSync(TARGET, { recursive: true })
    writeFileSync(dstPath, src)
    written.push(f)
  }
}

if (checkOnly) {
  if (drifted.length) {
    console.error(`\nUNITY DRIFT — ${TARGET}\n`)
    for (const d of drifted) console.error('  ✗ ' + d)
    console.error(
      `\nunity/Editor/ is canonical. Run \`npm run sync:unity\` to push it out,\n` +
        `or copy the Unity-side edit back into unity/Editor/ if that is where the\n` +
        `real change was made — but decide which, do not merge by hand twice.\n`,
    )
    process.exit(1)
  }
  console.log(`unity sync OK — ${files.length} file(s) identical in ${TARGET}`)
} else {
  if (written.length === 0) console.log(`unity sync — already up to date (${files.length} file(s))`)
  else console.log(`unity sync — wrote ${written.length}: ${written.join(', ')}\n  -> ${TARGET}`)
  console.log(
    `\nNOTE: new .cs files need a Unity .meta. Let the editor generate it and\n` +
      `commit it in HolobotsUnity alongside the script.`,
  )
}
