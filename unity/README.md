# Unity bridge — canonical source

`unity/Editor/*.cs` is the **canonical** copy of the Unity side of the bridge.
`HolobotsUnity/Assets/Holobots/Shared/Editor/` is a *copy* of it.

Edit here. Then:

```bash
npm run sync:unity              # write canonical -> Unity project
npm run sync:unity -- --check   # exit 1 on drift
```

The Unity project path comes from `$KAIJU_UNITY_PROJECT`, defaulting to
`../HolobotsUnity`. If the project is not present the check prints **SKIPPED**
and exits 0 — a skip, never a silent pass.

## Why canonical here rather than in the Unity repo

The contract in `bridge/schema/` is implemented on two sides. When one side
lived in a private repo, two of the three agents working this pipeline could
not see it, and `tools/check-contract.mjs` could only check the web half. A
contract with one side invisible is not a contract.

## Why a copy and not a git submodule

Unity's AssetDatabase wants real files under `Assets/` with `.meta` siblings it
owns and rewrites. A submodule there fights the importer for control of those
`.meta` files, and losing a `.meta` loses the GUID every scene reference points
at. A copy plus a drift check is duller and does not lose GUIDs.

## New files need a .meta

`sync-unity.mjs` writes `.cs` only. Let Unity generate the `.meta`, then commit
it in HolobotsUnity alongside the script. Never hand-author one.

## The files

| File | Role |
|---|---|
| `HoloCityPlacementExport.cs` | Unity → web. Emits `scene_export.json`, `palette.json`, and drives GLB export. Owns `SchemaVersion`, the `EditableComponents` whitelist, and `CurrentBaseHash()`. |
| `HoloCityPlacementImport.cs` | web → Unity. Dry-run report, per-entry validation, manual Apply, one Undo step. |
| `HoloCityGlbExporter.cs` | Async GLB export, pumped from `EditorApplication.update`. |

## The one rule in `HoloCityGlbExporter.cs`

**There is no `await` in that file and there must not be.** The first
implementation blocked the main thread on glTFast's `Task` via
`GetAwaiter().GetResult()`. That `Task` needs the main thread to progress, so
it deadlocked — it froze the editor twice on 2026-08-02 and needed a force-quit
both times. Passing `UninterruptedDeferAgent` did not help, because the
blocking wait was the defect, not the agent.

If a change to that file looks like a simplification into a synchronous loop,
that is the bug. It has already cost two sessions.
