# Design

Every decision the starter-credits bridge makes, the options it was chosen against, and
the reason. For what the bridge is and where its code lives, read
[README.md](README.md) first.

Two words recur. A **virtual key** is a credential the operator's proxy issues to a
caller. It carries a spend ceiling, an allowlist of models, and rate limits, and it works
only against that proxy. The **grant** is the spend ceiling on one organization's virtual
key. The bridge never sees the operator's real upstream provider credential; the proxy
holds that and attaches it server-side.

## What the bridge is not

- **Not a credit system.** There is no ledger, no balance, no purchase, no hold, and no
  refund. The proxy's own spend records are the accounting record for as long as the
  bridge runs.
- **Not a gateway.** A spendable credential still reaches the sandbox. What bounds it is
  the grant, the one-model allowlist, the per-key rate limits, and the team ceiling above
  all of them.
- **Not for OSS or self-hosted deployments.** All of the seeding code is under `api/ee`,
  which the OSS image never copies, and the code is inert unless a deployment supplies the
  configuration in [README.md](README.md#configuration).
- **Not permanent.** See [Teardown](#teardown).

## One key per organization, not one shared key

Options considered:

1. One virtual key for the whole deployment, seeded into every organization.
2. One virtual key per organization, minted at signup.

The bridge mints per organization. A shared key is one number that every organization
spends from, so the first heavy user consumes everyone's allowance, and a leaked key
exposes the whole program rather than one organization's remainder. Per-organization keys
give three properties a shared key cannot: total exposure per organization equals that
organization's own grant, spend is attributable per organization without extra plumbing,
and one abusive organization can be blocked on its own.

The cost is a mint call on the signup path. That call is bounded (10 seconds for the whole
seeding attempt) and its failure is swallowed, so a slow or unreachable proxy degrades the
signup to "no starter credits" rather than breaking it. The signup path deletes the new
user when setup raises, so swallowing is not politeness here. It is the only safe
behavior.

Minting exactly once is enforced twice. The key's alias on the proxy is the organization
id, and aliases are unique, so a retried signup hook gets a conflict rather than a second
key. The vault row has a fixed slug under a unique index on project and slug, and the
service reads that row before it mints, so an organization that already holds a seeded row
never reaches the mint at all.

## A vault connection, not a new funded route

Options considered:

1. Add a funded route through the API and teach the runner to use it.
2. Synthesize a platform-owned connection at resolution time, with no stored row.
3. Write an ordinary custom provider connection into the organization's vault.

The bridge writes a vault row. The run path already knows how to carry a custom provider
connection end to end: the SDK resolves it, the runner pins its one model at its base URL,
and the harness calls that URL with that key. Option 3 therefore needs no change in the
SDK, the runner, or the web app, which is the whole reason a bridge is affordable at all.

Option 2 is the better long-term shape, because a connection that exists only on the wire
cannot be read, renamed, or deleted by anyone. It is also a change across the SDK, the
runner, and the frontend's notion of a configured provider. That is the gateway's job, not
the bridge's.

Option 1 duplicates the gateway's routing work in a component that is designed to be
deleted.

The seeded row is an ordinary row in one respect only: it uses the same kind and the same
resolution path. In every other respect it is marked, and the next two sections are those
marks.

## The seeded value is write-only

Any project member can list the project's vault secrets. Before this change every one of
those responses carried decrypted values, so a seeded virtual key was readable by anyone
in the project with an API key.

The bridge creates its row with `write_only: true`, which means the value can be created,
replaced, and deleted, but never read back by a user. The platform runtime keeps reading
plaintext through a scoped grant, so runs are unaffected. This is the model GitHub uses
for repository secrets.

Two reasons to set it at creation rather than to add it afterwards. First, a row that
starts readable and is tightened later has a window in which the key is readable, and the
window is exactly the moment the organization is new and nobody is watching. Second, the
whole point of the seeded key is that the organization never supplied it and never needs
it: there is no user workflow that requires reading it back.

What remains true after the flag: anyone who can start a run in the project can spend the
grant, because the run itself reaches the key. The flag removes the casual read, not the
ability to spend. Spending is what the grant, the allowlist, and the rate limits bound.

The full contract is in [write-only-secrets.md](write-only-secrets.md).

## The seeded row is managed

`write_only` stops a read. It does not stop a delete, a rename, or a re-credential, and
all three break the seeded row in ways the user cannot repair:

- Deleting it strands the funded budget behind it. There is no repair path
  ([below](#no-repair-path)), so the organization is unfunded from then on.
- Renaming it breaks every saved model reference. The connection's display name is the
  namespace half of every model key it publishes, and a model key is permanent once a
  configuration references it (see
  [The display name is part of the contract](#the-display-name-is-part-of-the-contract)).
- Re-pointing its URL or key at something else turns a row the platform is responsible for
  into a row it is not.

So the bridge creates the row with `managed_by` set to its own name. A managed row is
read-only to users: update and delete both return HTTP 409. The marker is server
controlled, so a client that supplies `managed_by` on any request gets HTTP 400 rather
than being silently ignored.

The alternative considered was a per-field policy: keep the model list and the description
editable, pin everything else back to what was stored. It was dropped because the answer
to "can I save this form" never changed, and one sentence a user can act on ("this
connection is Agenta's") beats a per-field verdict that always says no.

## The mint policy comes from the operator, not from source

The mint policy is nine values: the grant, three per-key limits (concurrency, requests per
minute, tokens per minute), three velocity caps, the free-mail domain list, and one
eligibility rule (digit locals). The plus-tag rule is hardcoded, like the free-mail list,
and is not in the payload. None of the money values lives in this repository. They arrive as the payload of a
PostHog feature flag whose name is the only configurable part
(`AGENTA_STARTER_CREDITS_BRIDGE_POLICY_FLAG`).

Three reasons for that split. The values are the operator's money and the operator's abuse
posture, and neither belongs in an open source repository. They must change without a
redeploy, because the moment to lower a cap is the moment an abuse wave is running.
Keeping them in one payload also means no single field can be moved on one deployment in
isolation.

Resolution is deliberately awkward, and every branch fails toward not seeding:

| Situation | Result |
| --- | --- |
| Live payload present and valid | Seed. The payload is cached for transport outages |
| Live payload present and malformed | Do not seed. Alert the operator. The cache is deliberately not consulted, because a bad rollout must never silently keep the old caps |
| PostHog reachable, no payload | Do not seed. A reachable source with nothing to say is a real "no policy" signal |
| PostHog unreachable | Use the cached payload if there is one, otherwise do not seed |
| The deployment configured no PostHog key of its own | Use the built-in development policy |

That last row is the one exception, and it exists for a practical reason. A local stack or
a QA deployment has no way to publish a payload, so failing closed would block it with no
way to unblock. The development policy's values live in
`api/ee/src/core/starter_credits_bridge/types.py` and are deliberately generic: a small
grant and caps loose enough not to interfere with testing. They describe nothing about any
real program.

The check is on whether the deployment supplied its own PostHog key, not on whether
PostHog is enabled. The PostHog configuration falls back to a built-in project key, so
`enabled` is true in every checkout and could never tell a local stack from a real
deployment.

## Per-key concurrency and throughput caps

Every minted key carries a maximum number of parallel requests, a requests-per-minute
limit, and a tokens-per-minute limit, all from the policy payload.

The grant alone bounds what one organization can spend in total. It does not bound how
fast. Two things break under speed rather than volume. The upstream provider's throughput
quota is shared by everything the operator's credential serves, so one organization
looping calls can starve every other funded organization. And a burst that drains a grant
in minutes turns a trial into an error message before the person has typed a second
message.

The proxy also enforces its own upper bounds on what a key may be issued with. Raising a
policy value above the proxy's ceiling makes every mint fail with HTTP 400 until the proxy
configuration is raised and redeployed. Lowering a value is a live payload edit. That
asymmetry is intentional: loosening requires two people and a deploy, tightening does not.

## Only new signups, and never an existing organization

The mint sits in `provision_signup_subscription`, which runs only for organizations
created by the signup path. Creating an organization explicitly through
`POST /organizations/` runs `provision_user_subscription` instead and earns nothing. That
is the existing boundary against farming: making organizations in a loop from one account
gets no grants.

Existing organizations are never backfilled. Backfilling is a one-off script over the same
function, and holding it back costs nothing while the new-signup population is still being
watched.

An invited teammate is not a special case. They still sign up, and the signup path creates
their own organization unless they already belong to one, so they are seeded exactly like
any other new signup. Nobody has to seed an organization twice, and nobody has to decide
what an invitation into a funded organization means.

Velocity caps then bound the population that does qualify. They are counted in Redis
against expiring keys: a global daily count, a global hourly count, and a per-domain daily
count that applies only to domains that are not free mail. A cap on the world's most
common mailbox provider would treat every personal address as one company and would start
refusing real people immediately.

Two eligibility rules ride alongside the caps. On a non-free-mail domain, a digit in the
local part of the address is refused (`john99@acme.com`). That is the throwaway-address
pattern on a company mailbox. On free mail, digits are ordinary and stay allowed. A plus
sign in the local part is refused on every domain (`jane+1@gmail.com`,
`jane+trial@acme.com`), except `agenta.ai`. That is the mailbox-alias pattern: one inbox,
many strings, one grant each. The plus check is hardcoded, like the free-mail list. It is
not a PostHog field. Adding a required field to `MintPolicy` would stop every mint until
the live payload was edited, and plus-tagging is an industry abuse pattern, not an
operator money knob. Internal testers who need a plus tag use `@agenta.ai`.

The plus check applies to free mail as well as work mail. Plus-farming is a Gmail habit.
The digit rule stays work-only, because `john99@gmail.com` is a normal personal address.

Two properties of the counting are worth stating. If Redis is unreachable, seeding is
skipped, because a mint nobody can count is a mint nobody can bound. And when an attempt
consumes a counter slot but funds no key, the slot is handed back, so a proxy outage does
not quietly eat the day's allowance. Eligibility refusals (digit, plus) run before the
counters, so a refused address never consumes a slot.

### What a refused signup sees

A failed eligibility rule does not fail signup. The account is created. No virtual key is
minted. No vault row is written. The organization meets the same connect-your-key wall
every organization met before the bridge existed. A warning is logged with `rule` and
`domain` only. The local part is never logged. There is no operator alert. Alerts are for
outages (a missing policy, an unverifiable team, a seed that raised), not for a person
who did not qualify.

That silence is deliberate. The grant is a gift, not a signup gate. Telling the person
"your plus tag blocked the free model" teaches the farm how the filter works and still
leaves them without a key they can use.

### Mailbox tricks the plus rule does not catch

A plus tag is the cheapest farm. It is not the only one.

| Trick | Example | What we do |
| --- | --- | --- |
| Plus tags | `jane+1@gmail.com` | Refuse, except `agenta.ai` |
| Gmail dots | `j.ane@gmail.com` is the same inbox as `jane@gmail.com` | Not yet. Next homemade rule if we stay homemade |
| `googlemail.com` | same inbox as `gmail.com` | Already classified as free mail. Not folded into one mailbox |
| Disposable domains | mailinator, guerrilla, rotating MX farms | Not in the free-mail list. A maintained blocklist owns this better than we do |
| Yahoo hyphen tags | `jane-tag@yahoo.com` | Not yet. Real hyphens exist, so a blunt ban has more false positives |
| Catch-all company domains | `bot1@acme.com` | Bounded by `work_domain_daily` and the digit rule |
| Many orgs from one account | loop `POST /organizations/` | Already blocked. Only the signup path seeds |
| Unicode lookalikes | homoglyphs in the local part | Not yet. Rare, more false positives |

The known gap that none of those close: there is no per-address cap, because the signup
hook never sees the caller's network address. The domain rules and whatever bot
resistance fronts signup carry that load.

A homemade plus ban is a stopgap. It punishes a real work habit
(`billing+agenta@acme.com`) and misses Gmail-dot twins. The longer-lived owner is a
normalizer plus a disposable-domain list, or a vendor that already maintains both. That
survey is in [anti-abuse-research.md](anti-abuse-research.md). The plus rule still ships
first: it is one check, it closes the hole we can see today, and it does not send signup
addresses to anyone.

### How the plus rule is implemented

The check lives in `_mint_policy_allows`, next to the digit rule, before Redis counters.
The allowlist is a constant (`agenta.ai`, compared case-insensitively on the domain).
Tests cover: refuse `a+b@gmail.com`, refuse `a+b@acme.com`, allow `a@gmail.com`, allow
`a+b@agenta.ai`, no counter bump on refuse, log `rule=plus_local_part` and the domain
only. No PostHog payload change. The development policy does not need a new field.

This is a follow-up on `release/v0.114.0`. It does not reopen the seeding PR.

## The always-on ceiling: the program team

Every minted key joins one team on the proxy, and that team carries its own budget
ceiling. It is the bound that holds when nothing else does: if the policy is wrong, if the
velocity caps are too loose, if an abuse wave gets through, total spend still stops at the
team ceiling.

Because it is the last bound, the bridge refuses to mint unless it can verify the ceiling
stands. It reads the team from the proxy and requires a numeric, finite, positive budget
with no reset duration. A budget that resets periodically is a rate, not a total-exposure
bound, so it is refused too. An unverifiable team refuses and alerts.

A positive verification is trusted for ten minutes rather than for the life of the
process, so a ceiling that is removed or loosened at the proxy is caught without a
restart.

## No repair path

Seeding does two writes that can fail independently: it mints a key at the proxy, then it
writes the vault row. A crash between them leaves an organization with a live key that
nothing references.

The bridge handles that inline and then stops. If the row write fails, the service blocks
the just-minted key, so an orphaned grant can never be spent. Nothing retries later.

Options considered:

1. A reconcile sweep that finds half-seeded organizations and completes them.
2. An operator route that re-seeds one organization on request.
3. Nothing.

The bridge does nothing, and the reason is that anything which can mint for an existing
organization is a refill mechanism. The attack is cheap and obvious: spend the grant,
delete the connection (project members may delete their own connections), ask for a
repair, receive a fresh grant. Closing that hole means an invariant strong enough to state
in one line, "an organization's total lifetime grant never increases", and holding it
across crash boundaries. That is a signed record of the authorized remainder, a clamp on
every mint, and a record-then-replace protocol. It is real work, and all of it exists to
serve a failure that is rare.

The accepted cost, at the measured failure rate, is roughly one unfunded signup every two
hundred days. That organization sees the same connect-your-key wall every organization saw
before the bridge existed, which is not a regression.

The invariant is written down here because it is the contract any future repair path would
have to meet, not because anything implements it today.

## The display name is part of the contract

The seeded connection is named `Agenta`, and its model-key namespace is set to the same
string. That is not cosmetic. A custom provider connection publishes its models under
`<namespace>/<kind>/<model>`, and the resolver rebuilds keys under exactly that namespace.
A saved agent configuration that references one of those keys is referencing the name.

Two consequences follow.

The namespace must equal the display name. If they differ, a user reads one name in
settings and every saved reference carries another, and the resolver cannot find a model
whose key was written under the other spelling.

The name is permanent per row, not per deployment. An organization keeps the name it was
seeded with and the model keys that were built from it. Changing the constant renames
nothing that already exists. It only sets what the next organization gets, which means a
change after any real rollout leaves two namespaces in the field, each correct for its own
organizations. Treat the name as settled once seeding has run anywhere real.

`managed_by` is what keeps a user from creating the same problem from the other side by
renaming the row.

## Exhaustion is a product moment, not an error

When the organization's spend reaches the grant, the proxy refuses the call at admission
with HTTP 429. So does a per-key rate limit, and so does an upstream provider quota error.
Only the response body separates them.

The runner therefore classifies on the body, never on the status alone, and returns a
stable code alongside the human line (`RunErrorCode` in
`services/runner/src/engines/sandbox_agent/errors.ts`):
`starter_credits_exhausted`, `starter_credits_program_paused`,
`starter_credits_unavailable`, `rate_limited`, and `runner_error` for everything else. A
client can render a purposeful state from the code instead of parsing prose. Telling
someone their credits are gone when they were merely throttled is worse than saying
nothing, which is why the classification is narrow.

One consequence of seeding a real connection: the frontend's connect-your-key gate counts
it, so the key wall never appears for a funded organization. It also does not come back at
exhaustion. The exhaustion moment has to carry its own message, because nothing else will.

The path past the wall is the ordinary one. The user connects their own provider key and
points the agent at it. The seeded connection does not block adding another.

## Failure modes

| Situation | Behavior |
| --- | --- |
| Proxy unreachable at signup | Seeding fails inside its bound, is logged, and alerts. The organization is created unfunded and meets the ordinary key wall. Nothing retries |
| Proxy unreachable at run time | Funded runs fail with a connection error. The model is pinned, so there is no silent fallback to another provider. Organizations on their own keys are unaffected |
| Proxy up, its database down | Budget checks cannot run. The proxy must be configured to refuse rather than serve unmetered calls on the operator's credential |
| Redis unreachable | Velocity counters cannot be read. Seeding is skipped |
| Team ceiling missing, resetting, or unverifiable | Seeding is refused and the operator is alerted |
| Policy payload malformed | Seeding is refused, the operator is alerted, and the cached payload is deliberately not used |
| Mint succeeds, vault write fails | The key is blocked immediately. The organization stays unfunded |
| Signup retried while the first attempt is in flight | The alias conflict on the proxy, and the slug check in the vault, each stop the second grant |

## Teardown

The bridge is removed when a first-class funded path serves the same traffic. The order
matters, and two steps in it are easy to get wrong.

1. Stop seeding first, by clearing the policy payload. New signups then flow to whatever
   replaces the bridge.
2. Block every virtual key before deleting anything. Blocking is immediate and reversible.
   Deleting a connection row while its key is still spendable leaves a live credential
   nothing accounts for.
3. Snapshot spend per organization, and export the proxy's spend records. The proxy's
   database does not survive the teardown, so anything anyone will want later has to leave
   before it goes.
4. Rewrite every saved reference that carries the bridge's namespace, not only the ones
   currently in use. Agent revisions, evaluations, and jobs can all hold a model key.
5. Delete only rows proven to belong to the bridge, by secret id and by the ownership
   marker carried in the key's metadata on the proxy, never by slug alone. A user can
   delete a slug and create their own row under the same name.
6. Watch refused attempts on the old route, not successful traffic. Blocked keys make
   "zero successful traffic" true immediately while users are still broken. The signal is
   refusals trending to zero.

What survives the teardown: the exhaustion classification in the runner, the write-only
and managed vault contracts, and the exported spend history. Everything else is deleted,
including the EE module, the configuration, and the proxy itself.
