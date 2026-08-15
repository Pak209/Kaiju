# Contract changelog

Every change to `bridge/schema/**` gets an entry here, in the same PR, titled
`Contract-Change:`. See [`OWNERSHIP.md`](../OWNERSHIP.md) for the procedure.

An entry says **what broke if only one side follows**. That is the part that
matters — the schema diff already says what changed.

---

## 1.1.0 — 2026-08-15

All four documents move together (both sides gate on one version constant).

**What breaks if only one side follows:** a 1.0.0 web build's diffs are
refused by a 1.1.0 importer (version gate), and vice versa — loud, by design.
Old bundles must be re-exported; there is no silent migration.

- `placement_diff`: `modified[]`/`added[]` gain optional `state`/`priorState`
  — reparent (`parentId`, null = scene root), `active`, `layer`, `tag`,
  `staticFlags`, `materialVariant`. **Absence semantics:** only keys present
  in `state` are applied; every `state` key on a modify must have a
  `priorState` twin or the entry is refused — an unverifiable change is
  refused, not trusted. Layers/flags travel by NAME, never index. Also
  codifies behaviour that shipped since 1.0.0: baseHash mismatch is a warning,
  deletes go to `_PlacerTrash`, scale is world (lossyScale) both ways.
- `scene_export`: entries gain `parentId` (nearest ancestor entry) and a
  `state` baseline block — the values `priorState` is built from.
- `palette`: items gain `materialVariants`, a CLOSED set of named material
  swaps declared by `HoloCityVariantSet` assets in Unity. A diff names a key;
  material paths never cross the boundary. `defaultRotation`'s description is
  corrected from "compose" to "seed, then absolute" (see the 1.0.0 ambiguity
  below).
- `glb_manifest`: version aligned; no structural change.

Unity-side apply verified in a live editor against the real `CheckState`
path: apply, stale-prior conflict, unknown-layer/flag refusal, missing-prior
refusal, and unresolvable-parent refusal all behave as specified. The web
editor's session core (`stateDelta`, baseline, diff emission) is tested; the
UI controls that author reparent/layer/variant edits are follow-up work in
`src/` and until they land, `state` blocks simply do not appear in diffs.

## 1.0.0 — 2026-08-02

Initial frozen contract. Three documents:

- `holocity.scene-export` — Unity → web. Every rendering object with its
  Unity-space world transform, plus `editable` decided structurally.
- `holocity.palette` — Unity → web. The closed set of addable prefabs.
- `holocity.placement-diff` — web → Unity. Transforms, adds, deletes.

Both sides gate on exact `schemaVersion` equality, so a version mismatch is a
loud refusal rather than a subtle misread.

### Known ambiguity carried by 1.0.0

`palette.defaultRotation` is documented in the schema as *"placement must
COMPOSE with this default, never overwrite it"*, but the implementations do
not agree on that:

- `src/core.ts` seeds an added item's rotation **with** `defaultRotation` and
  stores it as absolute; the viewport never composes it again.
- `HoloCityPlacementImport` **also** composes: `rot * prefab.transform.rotation`.

The axis fix therefore lands twice on every added object, and 110 of 119
palette items have a non-identity default. `ARCHITECTURE.md` §2 now declares
**absolute on both sides** as the resolution, matching how `modified[]` and
scale already behave. The schema description is corrected in the next version
bump; until then, trust `ARCHITECTURE.md` over the schema comment.
