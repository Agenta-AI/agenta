# Status

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Current state

- Repository research confirms both provider formats share one vault and one secrets table.
- The proposed order separates API compatibility, settings, and Playground behavior.
- Subscription status remains separate runtime work.
- Founder-confirmed naming rule: the first unnamed standard connection uses the provider display
  name. Later unnamed connections append `2`, `3`, and so on.
- No product code changed.
- Provider research now separates free credential testing from model discovery.
- A draft default-active list exists for the eight provider families the Pi harness currently
  accepts from the Agenta vault.

## Current recommendation

Keep the two stored secret kinds. Add compatible optional fields and normalize both into one provider
connection concept. Do not convert old records and do not add a third secret kind for the first
release.

## Open decisions

1. Founder approval of the draft default-active model identifiers.
2. Default connection selection when several connections exist for one provider.
3. Whether a later change should cache discovery results. The current recommendation keeps the
   first response temporary and stores only active models.
4. Whether connection-level harness choices belong in the vault payload or in a non-secret settings
   resource. The current proposal keeps them beside models because both configure the connection.
5. Provider discovery route shape and ownership.
6. A confirmed free credential-test endpoint for MiniMax, Aleph Alpha, and current Anyscale-based
   connections, if one exists.

## Planning constraint

The feature-planning instructions request an interface-design skill for new contracts. That skill is
not available in this session. The draft manually separates identity, credentials, endpoint config,
model selection, user policy, and technical compatibility. A later review should use that skill if it
becomes available.
