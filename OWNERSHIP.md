# Ownership boundaries

Three agents work this repo in parallel. Merge conflicts and semantic drift are
the failure mode, not lack of throughput. The defence is **exclusive directory
ownership** — ownership by subsystem, never by task.

## The map

| Directory | Owner | Notes |
|---|---|---|
| `src/**` | **Codex** | The browser editor. Codex built it and holds the most context. |
| `unity/**` | **Claude** | Unity bridge C#. Requires an actual Unity editor to verify. |
| `tools/**`, `tests/**`, `fixtures/**` | **Grok** | Self-contained, fully testable without Unity or a GPU-in-the-loop. Good isolation. |
| `.github/**`, `ARCHITECTURE.md`, `OWNERSHIP.md`, `AGENTS.md` | **Claude** | Coordination surface. |
| `bridge/schema/**`, `bridge/CHANGELOG.md` | **NOBODY** | Gated. See below. |
| `README.md` | whoever's change requires it | Keep it accurate; it is user-facing. |

If your change needs a file you do not own, **do not edit it**. Open an
interface-change PR (below) or leave a `TODO(owner):` and say so in your PR
body. A drive-by fix in someone else's directory is how two agents end up
solving the same problem differently in the same week.

## The gated directory

`bridge/schema/**` is the contract. Both sides implement it independently, so a
unilateral change silently breaks the other side and the failure surfaces as a
bad transform, days later, in someone's scene.

To change it:

1. Open a PR that touches **only** `bridge/schema/**` and `bridge/CHANGELOG.md`.
2. Title it `Contract-Change: <what>`.
3. Body states: what changed, why, which side breaks if the other does not
   follow, and the migration for existing bundles.
4. **Claude reviews and merges it.** No self-merge.
5. Only then do the `src/` and `unity/` PRs that implement it land.

Bump `schemaVersion` on any change that is not purely additive-optional. Both
implementations gate on exact version equality, so a mismatch is a loud refusal
rather than a subtle misread — which is the intended behaviour.

## Interface-change PRs

Anything crossing a directory boundary — a new field, a renamed export, a
changed function signature another owner calls — is an interface change.
Same procedure as above, minus the schema version bump. Small, reviewed, landed
before the implementation PRs that depend on it.

## Working rules

- **One PR, one concern.** A PR that touches two owners' directories should
  have been two PRs.
- **CI is the reviewer.** None of us can self-assess renderer correctness by
  reading a diff. If CI is green and the golden-render gate is green, the
  change is probably fine. If you find yourself arguing that CI is wrong,
  fix the gate in its own PR first.
- **Never disable a gate to land a change.** If a gate blocks you and the gate
  is wrong, that is a separate PR with its own justification. A gate switched
  off "temporarily" is a gate that is off.
- **Update `ARCHITECTURE.md` in the same commit** as the behaviour it
  describes. It is the shared memory between three agents who do not share a
  context window.
- **Say what you did not verify.** "Tests pass, not run against a real Unity
  scene" is useful. Silence reads as verified.

## Escalation

Blocked on something only Pak can do — a Unity licence, a design call, a
purchased-pack question, anything touching `HoloCity_Main` — stop and say so
in the PR body under a `## Blocked` heading. Do not guess and do not work
around it quietly.
