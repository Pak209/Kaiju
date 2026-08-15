#!/usr/bin/env node
// Cross-side contract check.
//
// bridge/schema/*.json is implemented TWICE and independently: TypeScript in
// src/, C# in unity/Editor/. Nothing stops those two from drifting apart
// except this script, and the drift would surface days later as a bad
// transform in someone's scene rather than as an error here.
//
// So this checks three things:
//   1. every fixture JSON still validates against its schema
//   2. the C# and TS agree with the schema on schemaVersion
//   3. neither side references a `holocity.*` kind the schema does not define
//
// Exit 0 = the two implementations still speak the same contract.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// The schemas declare draft 2020-12, so the 2020 entry point is required —
// the default Ajv export does not know that meta-schema and throws on compile.
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const readJson = (p) => JSON.parse(read(p))

const failures = []
const notes = []
const fail = (msg) => failures.push(msg)

// ---------------------------------------------------------------- schemas

const SCHEMA_DIR = 'bridge/schema'
const schemas = {}
for (const f of readdirSync(join(ROOT, SCHEMA_DIR)).filter((f) => f.endsWith('.json'))) {
  const s = readJson(join(SCHEMA_DIR, f))
  const kind = s.properties?.kind?.const
  const version = s.properties?.schemaVersion?.const
  if (!kind) fail(`${f}: no properties.kind.const — every contract document must name its kind`)
  if (!version) fail(`${f}: no properties.schemaVersion.const`)
  schemas[kind] = { file: f, version, schema: s }
}

const KINDS = new Set(Object.keys(schemas))
const versions = new Set(Object.values(schemas).map((s) => s.version))
if (versions.size > 1) {
  fail(
    `schema versions disagree across documents: ${[...versions].join(', ')}. ` +
      `Both sides gate on a single SchemaVersion constant, so the three documents must move together.`,
  )
}
const CONTRACT_VERSION = [...versions][0]
notes.push(`contract version ${CONTRACT_VERSION}, kinds: ${[...KINDS].sort().join(', ')}`)

// ------------------------------------------------------- fixture validation

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

const FIXTURES = [
  ['fixtures/bundle/scene_export.json', 'holocity.scene-export'],
  ['fixtures/bundle/palette.json', 'holocity.palette'],
]
for (const f of readdirSync(join(ROOT, 'fixtures/goldens')).filter((f) => f.endsWith('.json'))) {
  const doc = readJson(join('fixtures/goldens', f))
  if (doc.kind && KINDS.has(doc.kind)) FIXTURES.push([join('fixtures/goldens', f), doc.kind])
}

for (const [path, kind] of FIXTURES) {
  if (!existsSync(join(ROOT, path))) {
    fail(`${path}: missing. Run \`npm run fixtures\` first.`)
    continue
  }
  const validate = ajv.compile(schemas[kind].schema)
  const doc = readJson(path)
  if (!validate(doc)) {
    for (const e of validate.errors) fail(`${path}${e.instancePath || ''}: ${e.message}`)
  } else {
    notes.push(`${path} validates as ${kind}`)
  }
}

// --------------------------------------------------------- C# side (unity/)

const CS_DIR = 'unity/Editor'
const csFiles = existsSync(join(ROOT, CS_DIR))
  ? readdirSync(join(ROOT, CS_DIR)).filter((f) => f.endsWith('.cs'))
  : []
if (csFiles.length === 0) fail(`${CS_DIR}: no C# found. The Unity side of the contract is canonical here.`)

let csVersionSeen = false
for (const f of csFiles) {
  const src = read(join(CS_DIR, f))

  // public const string SchemaVersion = "1.0.0";
  for (const m of src.matchAll(/SchemaVersion\s*=\s*"([^"]+)"/g)) {
    csVersionSeen = true
    if (m[1] !== CONTRACT_VERSION) {
      fail(
        `${CS_DIR}/${f}: C# SchemaVersion is "${m[1]}" but bridge/schema declares "${CONTRACT_VERSION}". ` +
          `The Unity importer gates on exact equality, so every diff from the web editor would be refused.`,
      )
    }
  }

  // any holocity.* kind string, however it is escaped into the emitted JSON
  for (const m of src.matchAll(/holocity\.[a-z0-9-]+/g)) {
    if (!KINDS.has(m[0])) {
      fail(`${CS_DIR}/${f}: references kind "${m[0]}", which no schema in bridge/schema defines.`)
    }
  }
}
if (csFiles.length && !csVersionSeen) {
  fail(`${CS_DIR}: no SchemaVersion constant found. The C# must pin the contract version explicitly.`)
}

// ------------------------------------------------------ TS side (src/types)

const ts = read('src/types.ts')
for (const m of ts.matchAll(/schemaVersion\s*:\s*"([^"]+)"/g)) {
  if (m[1] !== CONTRACT_VERSION) {
    fail(
      `src/types.ts: schemaVersion literal "${m[1]}" but bridge/schema declares "${CONTRACT_VERSION}".`,
    )
  }
}
for (const m of ts.matchAll(/holocity\.[a-z0-9-]+/g)) {
  if (!KINDS.has(m[0])) fail(`src/types.ts: references kind "${m[0]}", undefined in bridge/schema.`)
}

// core.ts emits the diff — its literals must match too
const core = read('src/core.ts')
for (const m of core.matchAll(/schemaVersion\s*:\s*'([^']+)'/g)) {
  if (m[1] !== CONTRACT_VERSION) {
    fail(
      `src/core.ts: emits schemaVersion '${m[1]}' but bridge/schema declares '${CONTRACT_VERSION}'. ` +
        `Every diff this build produces would be refused by the importer.`,
    )
  }
}
for (const m of core.matchAll(/holocity\.[a-z0-9-]+/g)) {
  if (!KINDS.has(m[0])) fail(`src/core.ts: emits kind "${m[0]}", undefined in bridge/schema.`)
}

// ------------------------------------------------------------------ report

if (failures.length) {
  console.error('\nCONTRACT CHECK FAILED\n')
  for (const f of failures) console.error('  ✗ ' + f)
  console.error(`\n${failures.length} problem(s).\n`)
  process.exit(1)
}
console.log('\ncontract check OK')
for (const n of notes) console.log('  ✓ ' + n)
console.log('')
