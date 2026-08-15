# Kaiju — HoloCity Placer

A bidirectional placement pipeline between Unity (the authority) and a local-only browser editor (the iteration surface). The editor renders locked scene context but keeps it structurally outside editable state, and its only Unity-facing output is `placement_diff.json`, which a human accepts or rejects inside Unity.

**If you are an agent working this repo, start here instead:**

| | |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How the pipeline works, the contract, the safety boundaries. Single source of truth. |
| [`OWNERSHIP.md`](OWNERSHIP.md) | Who owns which directory, and how to change the gated schema. |
| [`AGENTS.md`](AGENTS.md) | The short version you keep in your head. |
| [`unity/README.md`](unity/README.md) | The Unity side is canonical here and synced out to HolobotsUnity. |

```bash
npm run verify                  # typecheck + tests + build + contract checks
npm run sync:unity -- --check   # unity/Editor vs the HolobotsUnity copy
```

## Start

```bash
npm install
npm run fixtures
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`). Do not open `index.html` directly with a `file://` URL: this project uses TypeScript and package imports that Vite must transform and serve.

If localhost previews are unavailable, generate a directly-openable single-file build:

```bash
npm run preview:file
```

Then open `preview/index.html` with the browser. Unlike the source `index.html`, that file contains the compiled application and works from a `file://` URL.

Open the app, choose **Open Bundle**, and select `fixtures/bundle` for the synthetic 40-object scene. A Unity-produced bundle has the same shape: `scene_export.json`, `palette.json`, `meshes/*.glb`, and optional `thumbs/*.png`. Files are read locally; the app has no backend or telemetry.

## Workflow

1. Export a district/selection or whole town from the Unity menu tool.
2. Open that bundle folder in HoloCity Placer.
3. Select cyan/editable objects in the canvas or Scene list. Amber locked context is visible and raycast-occluding but never selectable.
4. Move, rotate, scale, duplicate, delete, or add from the exported palette.
5. Optionally download a working-session JSON and restore it later. Reopen the source bundle as well to restore its GLB files.
6. Choose **Export Diff**. Unity-space transforms, `baseHash`, and each touched object's `priorTransform` are included for importer conflict checks.

The Scene inspector includes local display layers for Vegetation, Buildings, Props, Terrain, Characters, Context, and Other. Eye controls hide or show whole layers to reduce draw work and visual clutter. A selected object can be reassigned with the **Display group** menu; these assignments are saved in working-session JSON but never appear in the Unity placement diff.

The editor never modifies the chosen folder or Unity project. Browser downloads are its only writes.

## Skybox composition workflow

The **Skybox Match** panel is a placement aid for bringing HoloCity's spatial
composition closer to a reference image while keeping the Unity boundary
explicit:

1. Choose **Load reference** to overlay a local concept image. Adjust its
   opacity or hide it whenever it blocks object picking.
2. Use **Hero view** for the fixed harbor-facing comparison camera or **Top
   view** for layout work.
3. Enable the 25 / 70 / 110 m rings to evaluate the central core, inner city,
   and waterfront bands.
4. For `HoloCity_Main`, **Apply first-pass macro layout** moves only recognized
   editable landmark instances. It does not move docks, terrain, water,
   vegetation, or locked context. The complete pass is a single undo step.
5. Shift-click objects or Scene rows for multi-selection. The transform gizmo
   then moves, rotates, or scales the selection together while preserving its
   relative arrangement. The people icon beside a display layer selects all
   editable objects in that layer.
6. Review the composition, save a working session, and export a placement diff.

These actions still do **not** modify Unity. `placement_diff.json` must be
opened by the Unity importer, pass its dry-run report, and be explicitly
applied in a copy/throwaway scene before `HoloCity_Main` is touched. Shoreline,
water, roads, procedural terrain, lighting, emissives, and material look-dev
remain Unity-side work.

The status bar reports unique asset progress as `GLBs loaded: N/total`. A failed GLB is rendered as a red bounds proxy, and the first loader exception is written to the browser console with its referenced bundle path. The directory input provides local files to the editor, which resolves GLBs and their sidecar resources through Blob URLs. This path works in the directly opened single-file preview without relying on File System Access handles.

For legacy bundles whose scene entries omit `glb`, display-only compatibility resolution tries the exact object name and then the prefab/FBX filename stem against the bundle's `glb/` directory. This does not alter scene IDs, prefab paths, edit state, or exported diffs. Locked context with no resolvable GLB is shown as a faint wireframe proxy and is excluded from automatic camera framing.

## Controls

| Action                      | Shortcut                              |
| --------------------------- | ------------------------------------- |
| Move / rotate / scale       | `W` / `E` / `R`                       |
| Duplicate                   | `Ctrl/Cmd+D`                          |
| Delete                      | `Delete` or `Backspace`               |
| Undo / redo                 | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Y`           |
| Frame selection / frame all | `F` / `Home`                          |
| Add/remove from selection   | `Shift` + left click                  |
| Orbit / pan / zoom          | right drag / Shift+right drag / wheel |

Snap uses 0.25 m translation, 15° rotation, and 0.1 scale increments. Inspector values and exported values are Unity-space (left-handed, Y-up, meters, quaternion xyzw); display conversion is isolated in `src/core.ts`.

The transform gizmo uses red X, green Y, and blue Z. In Move mode, drag an arrow for one axis or a colored square for two axes. In Rotate mode, drag a ring. In Scale mode, drag an axis or center handle.

## Verification

```bash
npm run fixtures
node fixtures/validate.mjs
npm test
npm run build
```

The fixture generator emits 30 editable objects across four fake prefabs, 10 locked objects including terrain, an asymmetric L shape, primitive GLBs, a SHA-256 `baseHash`, and the +90° Unity-Y quaternion golden in `fixtures/goldens`. Tests cover untouched identity diff, coordinate round-trip, the rotation golden, and structural locked exclusion.

The JSON schemas in `bridge/schema` are the frozen cross-repository contract. Do not change them without approval on both sides.
