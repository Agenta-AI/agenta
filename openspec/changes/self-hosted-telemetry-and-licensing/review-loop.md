<!-- review-loop: design=219a6223489c lenses=simplify,naming -->

**Review loop result** for design `219a6223489c` (code `ce68eea1af`), 3 rounds.

| Lens | Final rating |
| --- | --- |
| Simplify | Medium (one item left on purpose, see below) |
| Naming | Low |

Round ratings: round 1 simplify Medium (Codex), naming Medium (Codex) and High (Opus). Round 2 simplify High, naming Low (Codex). Round 3 simplify Medium (Codex). Naming did not run in round 3 because it was Low in round 2.

**Fixed:**
- The instance id setting is removed. The migration inserts the one `instances` row.
- The API no longer stores survey answers. The offer reads the answer in the browser.
- The plan of a self-hosted install with no key is named `self_hosted_community`. The cloud free plan stays separate.
- The key setting is `AGENTA_LICENSE_KEY`. `AGENTA_LICENSE` keeps its meaning (the edition).
- "Instance admin" is the one name for the person who manages the key.
- The key field `organization` is now `customer`.
- The feed fields follow the `Release` shape: one `securityFix` field, `minVersion` and `maxVersion`, and one version form.
- `instance_installed` replaces `oss_deployment_created`.
- The spec lists the values of the event properties, the heartbeat fields and the notice fields.
- design.md has a Names section with every route.
- The workspace count is removed from the heartbeat.
- The heartbeat and the install ping send inside one transaction that holds a row lock. Each event has a fixed id.
- One resolver gives the self-hosted plan to every reader.
- The newest security release stays in the feed after the 10-version limit.

**Left on purpose:**
- Simplify, Medium: a heartbeat can lose up to one hour of counts in one rare case: PostHog accepts the event and the database commit then fails. A pending payload would fix this, but it adds a column and a code path for trend data. design.md decision 5 records the limit.
- Naming, Low: `instance_heartbeat` keeps its noun form, because "heartbeat" is the usual name for this event.
- Naming, Low: the feed field `notices` keeps its name. The spec defines it as the list of feed messages.

The reviews that ran: Codex simplify in rounds 1 to 3, Codex naming in rounds 1 and 2, Opus naming in round 1. The Codex script did not fail.
