# Kaiju — Architecture

**This file is the single source of truth.** Claude, Codex, and Grok re-read it
at the start of every session. If code and this file disagree, that is a bug in
one of them — resolve it before writing anything else.

Changes to this file ship in the **same commit** as the code they describe.

---

## 1. What this is

A bidirectional placement pipeline between **Unity** (authority) and a
**local browser editor** (fast iteration surface).

Unity owns the project. The browser owns nothing. The browser is a scratch pad
that produces a *proposal*, and a human accepts or rejects that proposal inside
Unity. No web session can write to the Unity project.

```
  Unity scene
      |
      |  (1) EXPORT  Holobots ▸ HoloCity ▸ Placement ▸ Export …
      v
  bundle/                          <- gitignored; derives from purchased packs
    scene_export.json              holocity.scene-export
    palette.json                   holocity.palette
    glb/*.glb                      one per DISTINCT PREFAB, at identity
    glb/manifest.json              content hashes -> incremental re-export
      |
      |  (2) open the folder in the browser editor
      v
  browser editor  (src/)
      |
      |  (3) EXPORT DIFF
      v
  placement_diff.json              holocity.placement-diff
      |
      |  (4) IMPORT  Holobots ▸ HoloCity ▸ Placement ▸ Import Placement Diff…
      |      -> DRY RUN REPORT. Nothing is applied.
      |      -> a human reads it and presses Apply.
      v
  Unity scene  (one Undo step)
```

**Step 4 is never automated.** Watched folders may auto-*open* the dry-run
window; they may not auto-apply. See §6.

## 2. The contract

`bridge/schema/*.json` is the frozen cross-side contract. Three documents:

| Schema | Direction | Carries |
|---|---|---|
| `scene_export.schema.json` | Unity → web | every rendering object, editable or locked, with its Unity-space transform |
| `palette.schema.json` | Unity → web | the closed set of prefabs that may be added |
| `placement_diff.schema.json` | web → Unity | the only thing the web ever hands back |

Both sides implement these independently: TypeScript in `src/types.ts`, C# in
`unity/Editor/`. **Nothing keeps them honest except CI** — see §5.

### Coordinate space

Everything crossing the boundary is **Unity-space**: left-handed, Y-up, metres,
quaternion `xyzw`. The web editor converts to three.js for display and converts
back losslessly on export. That conversion lives in exactly one place,
`src/core.ts` (`unityToThree` / `threeToUnity`), and nowhere else.

The Unity side converts **nothing**. If you find a conversion in
`unity/Editor/`, it is a bug.

### Transform semantics — read this before touching a transform

Two rules that are easy to get subtly wrong, and whose failures look like
modelling faults rather than pipeline bugs:

1. **World in, world out.** `scene_export` transforms are world-space
   (`position`, `rotation`, `lossyScale`). The importer applies world-space.
   An editable instance may sit under a *locked scaled parent*, so
   `localScale` and `lossyScale` are not interchangeable.

2. **Rotations are ABSOLUTE on both sides, including adds.** Kit prefabs carry
   an axis-fix rotation on the root (110 of 119 palette items are non-identity).
   `palette.defaultRotation` publishes that value so the web editor can *seed*
   an added object with it. The web editor then stores and emits the total
   rotation. The importer **assigns** it — it must not compose with
   `prefab.transform.rotation`, because that applies the axis fix twice.

   The alternative design — web stores a delta, importer composes — is also
   coherent, but it is *not* what is implemented, and mixing the two is what
   the `add-then-rotate` golden exists to catch.

### Editability is structural, never by name

An entry is editable only if it is an outermost prefab instance and **every
component in its subtree** is on the whitelist in `HoloCityPlacementExport.EditableComponents`.
Unknown component ⇒ **locked**. It is a whitelist so that a new component type
defaults to safe.

Locked context is exported, rendered in the browser, occludes raycasts, and can
never be selected or appear in a diff.

## 3. Conflict detection

Two independent mechanisms, deliberately:

- **`baseHash`** — SHA-256 over the canonical JSON of a sorted `entries[]`.
  A **warning**, not a gate. It means "the scene changed somehow since export",
  which is normal: you were lighting while someone was placing.
- **`priorTransform`** — per entry. The importer refuses an individual entry
  whose live transform no longer matches. This is the real gate, and it is
  precise where `baseHash` is not.

`baseHash` was fatal until it was demoted, because a fatal whole-scene hash
means you cannot touch Unity while a browser session is open, which destroys
the iteration loop the pipeline exists to provide.

## 4. Repository layout

```
bridge/schema/      the contract. GATED — see OWNERSHIP.md.
bridge/CHANGELOG.md every schema version, and why it changed.

src/                the browser editor (React + three.js + Vite).
fixtures/           synthetic bundle + goldens. Committed. Owns nothing.
tests/render/       the golden-render parity gate.

unity/Editor/       CANONICAL Unity bridge C#.
                    HolobotsUnity/Assets/Holobots/Shared/Editor/ is a COPY.
                    `npm run sync:unity` writes it; `--check` fails on drift.

tools/              sync + contract-check scripts.
.github/workflows/  CI.
```

### Why the Unity C# is canonical here

It used to live only in the private HolobotsUnity repo, where two of the three
agents could not see it. A contract with one side invisible is not a contract.
It now lives here and is *copied out* to Unity, with CI failing on drift.

## 5. What CI actually proves

CI is the only reviewer that three parallel agents cannot talk out of a
verdict. It runs on every PR:

| Job | Proves |
|---|---|
| `web` | `tsc -b`, `vitest run`, `vite build` all pass |
| `contract` | every fixture JSON validates against `bridge/schema` |
| `cross-side` | the C# `SchemaVersion` and emitted `kind` strings match the schema `const`s — the two implementations still speak the same version |
| `render-parity` | the browser renders the fixture bundle the same as the committed Unity golden, **and** the known-bad fixture still fails |

The known-bad fixture is not decoration. A gate that has never gone red proves
nothing about its own sensitivity. `fixtures/goldens/render/` contains a
deliberately double-axis-fixed scene; if `render-parity` ever passes it, the
gate is blind and the build fails on that basis alone.

## 6. Safety boundaries — do not erode these

These are the reasons the pipeline is trustworthy. Each has already prevented a
real failure or exists because of one.

1. **Apply is manual.** Always. Watched folders may open the dry-run window;
   they may not press the button.
2. **Refuse, do not repair.** Every interesting failure here — stale session,
   mirrored handedness, leaked locked entry — produces a *plausible-looking*
   transform. Importing a plausible wrong number silently is the worst
   available outcome. Entries fail loudly and individually.
3. **The importer instantiates palette prefabs only.** Never an arbitrary
   `prefabPath`, never raw meshes.
4. **Deletes are reversible.** A diff delete reparents to a deactivated
   `_PlacerTrash` root; it does not destroy. Undo covers the session; the
   trash root covers everything after a domain reload.
5. **Sanity bounds are enforced, not documented.** Positions beyond ±2000 m and
   scales outside `[0.001, 1000]` are refused as unit/handedness errors.
6. **Bundles are never committed.** See `.gitignore`.

## 7. Known limits

- `id` is a Unity `GlobalObjectId`. Stable for saved scene objects; **zero for
  objects created and not yet saved**. Export after saving.
- GLB export is one prefab per editor tick with a 30 s timeout, and must never
  block the main thread — a blocking wait deadlocked the editor twice and
  required a force-quit both times. There is no `await` in
  `HoloCityGlbExporter.cs` and there must not be.
- The web editor has no backend and no telemetry. Its only writes are browser
  downloads, or a File System Access handle the user explicitly grants.
