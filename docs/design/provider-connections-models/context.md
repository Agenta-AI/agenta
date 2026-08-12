# Context

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Current user experience

Agenta presents standard provider keys and custom providers as different configuration flows.
Standard provider keys use Agenta's global model list. Custom providers store their own model list.

The agent Playground groups most models by provider, such as OpenAI, Anthropic, or OpenRouter. It
can also add custom-provider model groups from the project vault. Users cannot configure the models
shown for a standard provider connection, and the current settings behavior assumes one standard
key per provider.

## Goal

Let every stored provider connection carry optional model and harness choices. Support several
connections for the same provider. Preserve existing records and existing agents.

The first unnamed standard connection should use the provider's display name, such as `OpenAI`.
Later unnamed connections should use `OpenAI 2`, `OpenAI 3`, and so on. A user-provided name replaces
that generated display name.

## Target interface

The founder-provided design in [experience.md](experience.md) fixes the target interface. One term,
"Model providers", covers the playground banner, the picker footer, the drawer title, and the
Settings tab, which is renamed from "LLMs". The model picker lists connections rather than vendors.
One drawer component serves both the playground and Settings. Subscriptions stay
configuration-only. They appear beside stored connections without becoming vault records.

## Delivery approach

First make the API preserve the shared fields and make the resolver address both stored formats by
connection slug. Next add settings that edit those fields. Finally make the Playground list and save
connections rather than provider families alone.

## Non-goals

- Do not convert existing vault records.
- Do not add a third provider secret kind in the first release.
- Do not change the Playground in the first API pull request.
- Do not include subscription detection or persistence. The runner subscription-status project owns
  that work.
- Do not let a saved harness choice override Agenta's technical compatibility rules.

## Success criteria

- Existing `provider_key` and `custom_provider` records continue to work.
- New records of both types can preserve model and harness choices.
- Several standard connections can coexist for one provider.
- Settings can reopen exactly what the user saved.
- The later Playground can select and persist an exact connection, model, provider, and harness.
