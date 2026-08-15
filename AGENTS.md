# Agent rules — Kaiju

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) then [`OWNERSHIP.md`](OWNERSHIP.md)
before writing anything. This file is the short version you keep in your head.

## Hard rules

1. **Unity is the authority. The browser proposes; a human accepts.**
   Nothing in `src/` ever writes to the Unity project.
2. **Apply is manual, permanently.** Automate opening the dry-run report if you
   like. Never automate pressing Apply.
3. **`bridge/schema/**` is gated.** `Contract-Change:` PR, Claude reviews,
   lands before its implementations. See `OWNERSHIP.md`.
4. **Stay in your directory.** `OWNERSHIP.md` has the map.
5. **Unity-space crosses the boundary.** Left-handed, Y-up, metres, quaternion
   `xyzw`. Conversion happens in `src/core.ts` and nowhere else — never in
   `unity/`.
6. **Refuse, do not repair.** A wrong transform here looks plausible. Fail the
   entry, name the reason, name the object.
7. **Never commit a bundle.** GLBs baked from HoloCity prefabs derive from
   purchased packs, and this repo is public.

## Before you open a PR

```bash
npm run verify          # typecheck + tests + build + contract + cross-side
npm run sync:unity -- --check   # unity/ vs HolobotsUnity copy
```

Both green, or the PR body says which is red and why that is acceptable.

## Verification honesty

- Say what you ran and what you did not.
- A gate that passes is only evidence if you know it can fail. When you add a
  gate, add the known-bad case that it must reject, in the same PR.
- Numbers beat labels. "0.4 mm off after round-trip" is a finding;
  "transforms look correct" is not.
- Unit tests cannot substitute for a real Unity run or a real browser render.
  If your change needs one and you cannot do it, say so under `## Blocked`.

## Commit format

Follow the HolobotsUnity conventions:

```
<type>(<scope>): <imperative summary>

<why, not what>

Contract-Change: <only on bridge/schema changes>
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `qa`.
Scopes: `web`, `unity`, `bridge`, `tools`, `ci`, `fixtures`.
