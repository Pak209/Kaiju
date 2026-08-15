# HolocityPlacer — Execution Package (v1)

**Date:** 2026-08-02 · **Planner:** interim orchestrator (Fable) · **Approved scope:** Pak, 2026-08-02 morning
**Implementers:** Codex (this repo, the web editor) + Holobots Editor session (the two Unity menu tools)
**Contract:** `bridge/schema/*.json` — versioned. Changes to these files are contract changes and need Pak's sign-off on BOTH sides.

---

## 1. Goal

A standing, reusable **browser placement editor** for the HoloCity Unity project
(Blender-style: click-select, move/rotate/scale gizmos, duplicate, delete, place
new assets from a palette), so Pak can make placement adjustments visually
instead of describing them in text. The Unity project and the web editor never
touch each other's files: Unity **exports** a JSON manifest + per-prefab GLBs,
the browser edits placements, and hands back a **placement diff JSON** that a
Unity menu tool validates and applies.

Decisions already made by Pak (do not re-litigate):
- Scope: **HoloCity town** first (design generalizes to Neon Forest later).
- Operations: **full set** — move/rotate/scale, duplicate, delete, place-from-palette.
- Fidelity: **textured meshes** (baked base color via glTF; look-judgment stays in Unity).
- Lifespan: **standing studio tool** — versioned formats, documented, maintained.
- Granularity: **both** — district/selection export AND whole-town export.

**Non-goals (hard):**
- NOT an in-game feature. Internal authoring tool only. No mobile-bridge concerns.
- NEVER writes to the Unity project, its scenes, or its repo. Output = diff JSON only.
- No editing of terrain, procedural town meshes (roads/island), or any
  script-bearing object. Those export as **locked context** — visible, unselectable.
- No look-dev in the browser. URP toon/emissive/bloom do not survive glTF→Three.js;
  the browser answers "is it in the right place", never "does it read right".
- No backend, no accounts, no network calls, no telemetry. Local tool.

## 2. Repo layout (this repo, Codex owns)

```
HolocityPlacer/
  EXECUTION_PACKAGE.md      <- this file
  bridge/schema/            <- THE CONTRACT (scene_export, placement_diff, palette)
  fixtures/                 <- synthetic test bundle generator + goldens (task C1)
  src/                      <- Vite + Three.js app
  BLOCKERS.md               <- escalation log (create on first blocker)
```

## 3. Architecture (fixed)

```
Unity (Editor session)                    Browser (Codex builds)
──────────────────────                    ──────────────────────
Holobots ▸ HoloCity ▸ Placement ▸
  Export Selection… / Export Whole Town…
        │  writes an EXPORT BUNDLE dir:
        │  scene_export.json + palette.json
        │  + meshes/*.glb + thumbs/*.png
        └───────────────▶  drag-drop / folder-pick bundle into app
                           edit: gizmos, dup, delete, palette add
                           locked entries: rendered, raycast-occluding,
                           NEVER selectable, NEVER in the diff
                           undo/redo stack
                           Export Diff ▶ placement_diff.json (download)
        ┌───────────────◀
  Import Placement Diff…
    validates (schema, baseHash, editable-only,
    palette whitelist, priorTransform conflict check,
    NaN/scale sanity) → DRY-RUN REPORT window
    → Pak clicks Apply → Undo-able transaction
```

**Coordinate rule (the #1 correctness risk):** every number in every JSON is
**Unity-space** (left-handed, Y-up, meters, quaternion xyzw). The web editor
converts on load for Three.js display and converts back on export. glTF loaders
already flip handedness — do NOT convert twice. The identity test (task C4)
exists to catch exactly this, and it is the first thing to suspect if diffs
look mirrored or rotated.

**Instancing rule:** one GLB per unique prefab, shared by all instances
(`InstancedMesh` or clone-with-shared-geometry). Whole-town must stay loadable.

## 4. Codex task list (ordered; each check is binary)

- **C1 — Fixtures first.** Script (`fixtures/generate.mjs`) that emits a synthetic
  export bundle: ~40 entries (30 editable across 4 fake prefabs, 10 locked incl.
  one large "terrain" slab), valid palette.json, primitive-based GLBs, correct
  baseHash. Include one **asymmetric** mesh (L-shape) — required by C4.
  ✅ Bundle validates against all three schemas with `ajv`.
- **C2 — Viewer.** Load bundle (drag-drop or File System Access), render all
  entries at their transforms, locked entries tinted + badge, orbit/pan/fly
  camera, click-select with outline, stats overlay.
  ✅ Fixture scene renders; clicking a locked entry does nothing.
- **C3 — Gizmos + ops.** TransformControls move/rotate/scale (W/E/R), snap
  toggles (0.25m / 15° / 0.1), duplicate (Ctrl+D), delete, palette sidebar with
  thumbnails, click-to-place on ground plane, undo/redo (Ctrl+Z/Y) covering all ops.
  ✅ Every op undoes/redoes to exact prior state.
- **C4 — Diff export + THE IDENTITY TEST.** Export placement_diff.json.
  ✅ Load fixture bundle, touch nothing, export → `modified/added/deleted` all
  empty. ✅ Rotate the L-shape fixture exactly +90° about Unity Y → diff
  quaternion equals the golden value in `fixtures/goldens/`. These two checks
  are the coordinate-conversion proof and are **non-negotiable acceptance**.
- **C5 — Conflict & tamper hygiene.** priorTransform recorded on every touched
  entry; baseHash echoed; locked entries structurally impossible to include
  (not filtered out at export — never representable in the edit state).
  ✅ Attempting to move a locked entry via console/devtools does not mark it dirty.
- **C6 — Session save/restore.** Save working state to a local file; reopen and
  continue. ✅ Save → reload → byte-identical diff export.
- **C7 — Polish for standing use.** README with the full workflow, keyboard
  reference in-app, district vs whole-town both tested with a 5k-instance
  synthetic bundle at interactive framerate (instancing proof).

## 5. Unity-side task list (Editor session, NOT Codex — spec'd here for the contract)

- **U1 — Export Selection… / Export Whole Town…** menu tools. Editable = static
  kit/prop instances under configured roots with only whitelisted components
  (Transform/MeshFilter/MeshRenderer/LODGroup/Collider). Everything else in view
  = locked context. Terrain exports as decimated proxy, locked. GLB via glTFast,
  baked base color. IDs = GlobalObjectId. Palette = kit prefab allowlist
  (**excludes** Meshy Pine/Willow per the city-trees rule, excludes anything
  script-bearing).
- **U2 — Import Placement Diff…** validates schema + baseHash + editable
  allowlist + palette whitelist + priorTransform-vs-current conflict check +
  sanity (NaN, |scale| bounds, position within town bounds) → dry-run report
  listing every change → single Undo-able apply. Added objects are prefab
  instances, rotation **composed** with the prefab's default root rotation
  (kit axis-fix rule), named `<Prefab>_wp###`.
- **U3 — Round-trip proof on a THROWAWAY scene** before HoloCity_Main is ever
  touched (gate G2).

## 6. Gates (implementer stops and reports; never routes around)

- **G1 — Schema freeze.** Pak approves `bridge/schema/*` before U1/U2 are built.
  Codex may build C1–C7 against the schemas as-is in parallel; if a schema
  change is needed, STOP → BLOCKERS.md → Pak. (Schema changes after freeze =
  `Contract-Change:` commit on the Unity side.)
- **G2 — First real import** runs on a copy/throwaway scene with Pak watching
  the dry-run report. Only after his OK does the importer touch HoloCity_Main.
- **G3 — Any commit in the Unity repo** follows that repo's rules (pathspec-only,
  metas travel, Editor session's validation pass). Codex never commits there.

## 7. Validation summary

| Test | Where | Pass condition |
|---|---|---|
| Schema validity | ajv in CI/`npm test` | all fixtures + all app exports validate |
| Identity round-trip | C4 | untouched bundle → empty diff |
| Rotation golden | C4 | +90°Y on asymmetric fixture → golden quaternion |
| Locked tamper | C5 | locked entry cannot become dirty |
| Conflict detect | U2 | changed-in-Unity object → flagged, not clobbered |
| Compose-rotation | U2 | palette add of an axis-fixed kit piece lands upright |
| Perf | C7 | 5k instances interactive |

## 8. Escalation

Blocked, ambiguous, or tempted to change the contract → write `BLOCKERS.md`
(what, why, smallest unblocking decision) and stop that thread; continue any
unblocked tasks. Never: edit Unity files, widen the editable set, add network
calls, or "fix" coordinates by trial-and-error past the C4 goldens — if C4
fails, the conversion is wrong somewhere specific; find it, don't fudge it.

## 9. Degradation check

What breaks first with a weaker implementer: **silent double handedness
conversion** (diffs mirrored — caught by C4), **locked-entry leakage via the
selection model** (caught by C5's structural rule), **palette placements
overwriting kit root rotations** (caught by U2's compose test). All three have
named tests precisely because they fail silently otherwise.
