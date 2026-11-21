<!-- review-loop: design=2f9c4df52226 lenses=simplify,naming -->

**Review loop result** for this design at repo commit `9f7fc1cc42` (branch `feat/self-hosted-free-key`), 3 rounds plus one check of the round 3 fixes.

| Lens | Final rating |
| --- | --- |
| Simplify | Low (round 3) |
| Naming | Low (check after round 3) |

**Fixed:**
- The `licenses` table had two migrations that both create it. The OSS chain now owns it alone, and `ee0000000010` is deleted. Dev stacks that ran it downgrade once.
- "RBAC" meant both role checks and the paid role catalog. The spec now says "full role catalog".
- The per-instance and per-user organization limits had near-identical names. The new names all say "instance".
- The project and organization checks now have one shape: `check_*` functions that raise `*ReachedError` with `code` and `limit`.
- The cloud check had several copies. `is_cloud()` now lives once in OSS, and one function picks the cloud or self-hosted limit.
- The spec now names which paths check the limits. Platform admin routes are exempt on purpose.
- The plan sets moved to `licenses/types.py` to avoid an import cycle, and EE reuses them instead of a second copy.
- Sign-up now calls the organization check before it creates the personal organization (it never reached the check before).
- The /m License tab now shows the add-a-key form on OSS, so the activation link works there.

**Left on purpose:**
- The word "registration key" stays in code and the spec next to the `registration-1` signing key. /m text says "free key", as the existing screens do.
