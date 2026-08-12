# Status

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Current state

- Repository research confirms both provider formats share one vault and one secrets table.
- The proposed order separates API compatibility, settings, and Playground behavior.
- Subscription status remains separate runtime work.
- The founder provided a clickable interface prototype and handoff notes on 2026-08-12. The design
  is recorded in [experience.md](experience.md) and the prototype sits beside it.
- Founder-confirmed naming: the surface is called "Model providers" everywhere, and the Settings
  tab is renamed from "LLMs".
- Founder-confirmed connection naming rule: the first unnamed standard connection uses the provider
  display name. Later unnamed connections append `2`, `3`, and so on.
- Founder-confirmed structure: the picker lists connections, the flyout lists one row per model and
  harness pair, one drawer serves the playground and Settings, and the connection card replaces
  modals.
- No product code changed.
- Provider research separates free credential testing from model discovery. The card exposes both
  through one Test action.
- A draft recommended-model list exists for the eight provider families the Pi harness currently
  accepts from the Agenta vault.

## Current recommendation

Keep the two stored secret kinds. Add compatible optional fields and normalize both into one provider
connection concept. Do not convert old records and do not add a third secret kind for the first
release.

## Open decisions

1. Founder approval of the draft recommended model identifiers. The "recommended" tag itself is
   confirmed by the design; the identifier list is not.
2. Default connection selection when several connections exist for one provider.
3. Whether a later change should cache discovery results. The current recommendation keeps the
   first response temporary and stores only active models.
4. Whether connection-level harness choices belong in the vault payload or in a non-secret settings
   resource. The current proposal keeps them beside models because both configure the connection.
5. Provider discovery route shape and ownership.
6. A confirmed free credential-test endpoint for MiniMax, Aleph Alpha, and current Anyscale-based
   connections, if one exists.
7. Done gating for providers without a free credential test. The design disables Done until the key
   is valid, which would block DeepInfra, Perplexity, MiniMax, and Aleph Alpha forever. Draft
   recommendation: enable Done when a key is present and the credential status is `unknown`, with
   copy that says the key was saved untested.
8. Pin versus follow for the pre-checked recommended set. If Done saves the untouched pre-checked
   models as an explicit list, the connection never gains models that Agenta recommends later. If
   Done records no explicit choice, the connection follows future recommendations but its model
   list can change without user action. Draft recommendation: save the explicit list, because the
   proposal already promises that nothing changes a saved list silently.
9. Where the subscription model shortlist persists and which project owns it. The design makes the
   shortlist editable, but a subscription is runtime state, not a vault record. Draft
   recommendation: a small non-secret per-project settings record owned by the runner
   subscription-status project; this folder only reserves the concept.

## Planning constraint

The feature-planning instructions request an interface-design skill for new contracts. That skill is
not available in this session. The draft manually separates identity, credentials, endpoint config,
model selection, user policy, and technical compatibility. A later review should use that skill if it
becomes available.
