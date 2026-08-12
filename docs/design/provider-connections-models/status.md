# Status

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Current state

- Repository research confirms both provider formats share one vault and one secrets table.
- The proposed order separates API compatibility, settings, and Playground behavior.
- Subscription status remains separate runtime work.
- Founder-confirmed naming rule: the first unnamed standard connection uses the provider display
  name. Later unnamed connections append `2`, `3`, and so on.
- No product code changed.

## Current recommendation

Keep the two stored secret kinds. Add compatible optional fields and normalize both into one provider
connection concept. Do not convert old records and do not add a third secret kind for the first
release.

## Open decisions

1. Meaning of an absent model list versus an explicitly empty model list.
2. Default selection when several connections exist for one provider.
3. Whether the first API change stores only active models or also cached discovery results.
4. Whether connection-level harness choices belong in the vault payload or in a non-secret settings
   resource. The current proposal keeps them beside models because both configure the connection.
5. Provider discovery route shape and ownership.

## Planning constraint

The feature-planning instructions request an interface-design skill for new contracts. That skill is
not available in this session. The draft manually separates identity, credentials, endpoint config,
model selection, user policy, and technical compatibility. A later review should use that skill if it
becomes available.
