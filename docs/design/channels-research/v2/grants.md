# Where an agent may answer

Supersedes the grant half of `entities.md` §2.5. The taxonomy was right and the
mechanism could only express one third of it.

## The defect

`resolve` default-denies when no `channel_spaces` row matches. So **permission is
encoded as "somebody pre-created a row"**, and that only works where spaces can be
pre-created.

| kind | can it be enumerated in advance? | why not |
| --- | --- | --- |
| `topic` | yes — few, named, pre-existing | — |
| `private` | **no** | one per user, unbounded, created by someone talking |
| `group` | **no** | an arbitrary set of people, formed ad hoc |

Two of three cannot. `capabilities.md` declares `spaces.private: true` for Slack and
the mechanism cannot express it, so **every DM to a Slack bot is silently refused
today** unless an operator pre-approved that exact DM — and a DM opened after setup
could not have been.

It is worse than a missing feature: the refusal is silent by design (D17), so the
failure is a bot that answers in channels and ignores DMs with no diagnostic.

## Two jobs in one row

A space row is doing two things, and only one of them justifies the table:

1. **A record of a place** — it owns the inbox log (`channel_inbox_events.space_id`),
   the once-per-place backfill guard (`flags.is_backfilled`), one of the three policy
   levels, and the session-id fallback when a platform has no threads.
2. **The permission to answer there** — by existing.

Job 1 is real and the table stays. Job 2 is the defect: it conflates *a place we
know about* with *a place an agent may speak in*, and it is why permission can only
be instance-level.

**So the row is created on first contact**, by the same get-or-create that already
makes threads, and it authorises nothing.

## Grants become allow and deny rules

`entities.md` already puts *"which agent may act where"* on `channel_grants`, and D29
puts the default-agent flag there because **the grant's existence is the
permission**. A grant that names a *kind* rather than an *id* is that same statement
one level up.

```python
class ChannelGrantDBA(...):
    agent_id = Column(UUID, nullable=False)
    effect   = Column(Enum(ChannelGrantEffect), nullable=False)  # ALLOW | DENY
    kind     = Column(Enum(ChannelSpaceKind), nullable=True)     # any space of this kind
    space_id = Column(UUID, nullable=True)                       # this space
```

Exactly one of `kind` and `space_id` is set. Both null matches nothing and is a bug;
both set is a narrower rule than either and is not needed, so it is rejected at
write time rather than given a meaning.

Reading the rows as sentences:

- `(triage, ALLOW, kind=private)` — answers any DM
- `(triage, ALLOW, kind=topic)` — answers any channel it is in
- `(triage, DENY, space=#secrets)` — except that one
- `(deploy, ALLOW, space=#ops)` — only there

## Evaluation: deny wins, then allow, then refuse

```text
rules = grants for (agent) matching this space by id or by kind

if any DENY matches   -> refused
elif any ALLOW matches -> allowed
else                   -> refused        # default-deny, unchanged
```

**Deny wins regardless of specificity**, and that is deliberate. The alternative —
most-specific-wins — is precisely what D25 rejects, because it lets a narrow rule
re-enable something an operator disabled broadly.

**This is not an override mechanism, and the distinction matters.** D25 forbids a
narrow *allow* beating a broad *deny*. A narrow *deny* beating a broad *allow* is
D25's own rule, in its own words: *"a stated `false` wins"*, *"a thing happens only
if every level that spoke about it allows it."* Allow-by-kind with deny-by-id is
that rule applied to grants, not an exception to it.

**The accepted cost, stated rather than discovered:** you cannot re-allow one space
inside a denied kind. `(DENY, kind=topic)` plus `(ALLOW, space=#ops)` refuses
`#ops`. If that is what someone wants, the fix is to unstate the broad denial and
allow the topics individually — a configuration change, not a semantics change. Same
cost D25 already accepts for policy, for the same reason.

## What this does not change

**Default-deny.** No matching allow is still a refusal. The security posture's
*"a space must be granted before the agent answers there"* holds; what changes is
that a grant can now be written for a space that does not exist yet.

**Refusals stay indistinguishable** (D17). Denied by rule, no matching allow, no such
agent — one sentence for all three, so nothing is enumerable.

**The three policy levels.** A space row still carries `data.policy` and still
participates in the intersection. Only the permission moved.

## Two absences that now sit next to each other

Worth writing down because they are adjacent for the first time and mean opposite
things:

| absence | means |
| --- | --- |
| no matching grant | **refused** — default-deny |
| a policy field unset | **no opinion** — falls through to the channel default |

A reader who conflates them gets default-allow, which is the failure this whole
posture exists to prevent.

## Schema notes

**`space_id` becomes nullable**, which breaks the current unique constraint:
`(project_id, agent_id, space_id)`. Postgres treats NULLs as distinct, so that
constraint stops preventing duplicates the moment a kind-level row exists. It needs
replacing with two partial unique indexes — one where `space_id IS NOT NULL`, one
where `kind IS NOT NULL` — each including `effect`.

**The default-agent index needs the same treatment.** `uq_channel_grants_default` is
partial-unique on `(project_id, space_id)` where `flags.is_default`. With kind-level
grants, *"the default agent for any private space"* is expressible and probably
wanted, so the index must cover `kind` too. A deny row must never carry
`is_default`; that is a write-time check.

**Nothing is released**, so this is an edit to the existing revision rather than a
migration on top of it.

## Still open

- **Whether a deny needs to be sharper than a whole space** — denying an agent in a
  space for a period, or for one thread. Nothing asks for it yet, and adding it later
  is additive.
- **What the Agenta channel's spaces are.** Settled enough to build: a private space
  per user, threads within it per agent — the same shape as a Slack DM, and covered
  by one `(ALLOW, kind=private)` rule with no enumeration.
