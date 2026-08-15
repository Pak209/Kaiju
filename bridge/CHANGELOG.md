# Contract changelog

Every change to `bridge/schema/**` gets an entry here, in the same PR, titled
`Contract-Change:`. See [`OWNERSHIP.md`](../OWNERSHIP.md) for the procedure.

An entry says **what broke if only one side follows**. That is the part that
matters — the schema diff already says what changed.

---

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
