# Blockers

## 2026-08-02 — Rendered browser acceptance pass

- **What:** The Codex in-app browser rejected navigation to `http://127.0.0.1:5173` under its browser security policy, so a rendered screenshot and interaction pass could not be captured in this session.
- **Why it matters:** C2/C3 visual interaction and the C7 5k-instance interactive-framerate acceptance check require a real browser/GPU run; type checks and unit tests cannot substitute for them.
- **Smallest unblocking decision:** Run `npm run dev`, open the local URL manually, load `fixtures/bundle`, and perform the checklist in `README.md`; or explicitly provide an approved browser-access path in a later task.

No schema or Unity-side files were changed.
