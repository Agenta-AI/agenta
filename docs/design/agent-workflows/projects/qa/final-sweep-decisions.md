# Final AI QA sweep — decisions log

This log records judgment calls made during the autonomous sweep without stopping for user
approval. The goal is transparency: any judgment that changes scope, skips a cell, changes
a config, or treats a near-pass as a pass is recorded here so the user can review and
reverse it.

A decision is reversible when the affected cell can be re-run with the original setup at
low cost. A decision is not reversible when it affects a vault credential, a committed
agent config, or a dependency that takes time to recreate.

---

| Date | ID | Decision | Why | Reversible? |
|------|----|----------|-----|-------------|
| 2026-06-25 | D-001 | Deleted the orphan `services/agent/skills/agenta-getting-started/SKILL.md` (single source of truth = the catalog) instead of wiring it in. | The runner materializes skills from the wire into per-run temp dirs and never reads that file path; grep confirmed no code references it. The LIVE getting-started body is `api/oss/src/core/workflows/platform_catalog.py` (`_GETTING_STARTED_BODY`). Wiring the orphan in would change the served skill body, so deleting the dead, diverged copy is the safe reconcile. | Yes — restore the file from git history if a code path is ever added that reads it. |
| 2026-06-25 | D-002 | Reconciled the overclaiming comment on `AGENTA_FORCED_TOOLS` in `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`; deferred making the forced-tools mechanism actually deliver builtins over the wire. | The old comment claimed read+bash are forced "because Pi only renders skills when read is available," but the runner never consumes `request.tools` / `builtin_names` to grant builtins — Pi gets `read`/`bash` from its own DEFAULTS, so skills render regardless of this list. Comment-only fix now; wiring the forced set to deliver builtins on the wire is deferred (it works via Pi defaults today). | Yes — the deferred wiring is a tracked follow-up; the comment can be revised when it lands. |
| 2026-06-25 | D-003 | **Correction of D-001 — it was WRONG.** Restored `services/agent/skills/agenta-getting-started/SKILL.md` (byte-exact from `9b24931b32^`). D-001 deleted it as a "dead file," but the dir is REQUIRED at build time: both `services/agent/docker/Dockerfile:43` and `Dockerfile.dev:32` do `COPY skills ./skills`, which fails when the path is missing — the deletion broke the `agenta-sandbox-agent` image build on big-agents. The EE/OSS dev compose also bind-mounts `services/agent/skills:/app/skills`, so a missing host dir empties the mount. Restored, then proved the prod build now passes the COPY step and completes (image `agenta-sandbox-agent-buildtest`), and the rebuilt dev image + recreated `:8280` sidecar is healthy with the skill present. | What D-001 got RIGHT and is NOT reversed: the served getting-started skill BODY at runtime comes from the Python catalog (`_GETTING_STARTED_BODY` in `api/oss/src/core/workflows/platform_catalog.py`, slug `_agenta.agenta-getting-started`), injected over the `/run` wire via the embed; the runner materializes `request.skills` into per-run temp dirs and never reads the baked dir. So the baked file is dead-at-runtime but required-at-build. The deeper reconcile (the baked placeholder has diverged from the catalog body — collapse to one source, e.g. generate the dir from the catalog at build time or drop the COPY and stop bind-mounting) is a DEFER-TODO; do NOT re-delete the dir without first removing the Dockerfile COPY and the dev-compose bind-mounts in the same change. | No — the file is back in git; reversing this re-breaks the build. |

---

## How to add an entry

When you make a judgment call, append a row:

- **Date**: ISO date, e.g. `2026-06-25`.
- **ID**: `D-NNN` in sequence.
- **Decision**: what you decided (one sentence, concrete).
- **Why**: the reasoning that drove it (one sentence; cite the relevant cell ID if applicable).
- **Reversible?**: Yes / No / Partial — and what reversal requires if not trivial.

Do not edit or delete prior rows. If a decision was wrong, add a new row noting the
correction and referencing the original `D-NNN`.
