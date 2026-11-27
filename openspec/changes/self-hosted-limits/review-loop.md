<!-- review-loop: design=3a4b51c34bb0 lenses=simplify,naming -->

**Review loop result** for the one-image design at repo commit `ccd6deea04` (branch `feat/one-image-spec`), 2 rounds on 2026-11-25. The hash covers every Markdown file in this folder except this record, computed from the repo root with `find openspec/changes/self-hosted-limits -type f -name '*.md' ! -name review-loop.md | sort | xargs sha256sum | sha256sum`. The earlier record (design `3a864fd9c1ab`, 21 November) covered the design before the 2026-11-25 decisions.

**Delta round on 2026-11-26** (design `3a4b51c34bb0`, repo commit `aebc55e15f`): one round, Codex on simplify and on naming, both Low with no findings. It covered two wording changes made after Devin review comments: the setup answers go with a registration only when the admin answered the setup survey, and the Helm upgrade path is `helm upgrade` to the new chart version, with a new "Helm upgrade" scenario.

| Lens | Final rating |
| --- | --- |
| Simplify | Low (Codex, rounds 1 and 2) |
| Naming | Low (round 2, Codex; round 1 Opus was Medium) |

**Fixed:**
- Decision 13 has one table that maps each plan value to its plan name and badge, as in the approved screens. The "Registered plan" in the license text is the Community plan with the Registered badge.
- The dismiss route is `/instance/license/registration-offer/dismiss`, the response field is `registration_offer_dismissed`, and the design says that Skip or finishing the step stores it, in onboarding and in the one-time offer.
- An unticked updates box leaves the stored `agentaProductUpdates` value unchanged (Mahmoud to confirm, after a security review changed it).
- The merge order puts #8237 before #8242, because #8242 needs the instance id from #8237. #8240 sends the instance id in its update check only after #8237 is in.
- Task R.12 is checked off, because the analytics sentence is on the #8237 telemetry page.

**Left on purpose:**
- The "Free" badge on the no-key plan stays, because the owner approved the 8 screens with it.
- `usage.users` keeps its plain number shape with the seat limit in `license.seats`, because that part belongs to #8242. Giving it the `{count, limit}` shape is a possible follow-up.
- The one-image scenario that says no `self_hosted_deployment_created` event is sent stays, because it states the decision.
