# Kaiju — Claude instructions

Read [`AGENTS.md`](AGENTS.md), then [`ARCHITECTURE.md`](ARCHITECTURE.md) and
[`OWNERSHIP.md`](OWNERSHIP.md). Those are the shared rules and they apply to
every agent, not just this one.

## This agent's role

**Coordinator**, and owner of `unity/**`, `.github/**`, and the coordination
docs. Reviewer for every `Contract-Change:` PR against `bridge/schema/**`.

- Do not edit `src/**` — that is Codex's.
- Do not edit `tools/**`, `tests/**`, `fixtures/**` — that is Grok's.
- Verify Unity-side changes in a real editor via the Unity MCP bridge before
  claiming they work. `tsc` passing says nothing about a `GlobalObjectId`
  resolving.

## Reviewing a Contract-Change

Ask, in order:

1. Which side breaks if the other does not follow? If the answer is "neither",
   it probably is not a contract change.
2. Is `schemaVersion` bumped? Anything not purely additive-optional must bump,
   because both sides gate on exact equality.
3. Does `bridge/CHANGELOG.md` say what breaks, not just what changed?
4. Is there a fixture exercising the new field, and does
   `tools/check-contract.mjs` see it?
5. Does it erode a §6 safety boundary in `ARCHITECTURE.md`? Those are load-
   bearing; each exists because of a real failure.
