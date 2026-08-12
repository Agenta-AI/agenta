# Status

> AGENT-GENERATED, low weight. This is a draft. Mahmoud must approve product and interface decisions.

## Current state

- Repository research confirms both provider formats share one vault and one secrets table.
- The proposed order separates API compatibility, settings, agent Playground behavior, and the
  prompt and evaluator wiring.
- Subscription status remains separate runtime work.
- The founder provided a clickable interface prototype and handoff notes on 2026-08-12. The design
  is recorded in [experience.md](experience.md) and the prototype sits beside it.
- The founder reviewed this plan on pull request 5987 on 2026-08-12. This revision addresses every
  review comment. Where a comment contradicts the prototype or the earlier draft, the comment wins.
- No product code changed.

## Decisions resolved by the founder's review (2026-08-12)

1. **Naming: "AI providers"**, not "Model providers" and not "LLMs". Applied everywhere: banner,
   picker footer, drawer title, Settings tab.
2. **The Settings drawer shows the catalog only.** Existing connections live in the Settings
   table, and a table row opens the connection card directly.
3. **Aleph Alpha is removed from the catalog.** The company is defunct. Stored records keep
   resolving.
4. **AWS Bedrock, Azure OpenAI, Google Gemini, and Vertex AI are in scope**, with their different
   configuration shapes. The data model stays general: structured-credential providers use the
   existing custom-provider record with per-kind field sets.
5. **Manual model IDs are always available**, for every provider in every state.
6. **The curated pre-checked list is called "default models"**: the models selected per default.
7. **Default model identifiers corrected**: OpenAI is GPT-5.6 Luna, Terra, and Sol. Anthropic adds
   Opus 5 and Fable 5. OpenRouter follows current usage rankings and includes GLM-5.2 and the
   latest DeepSeek Pro and Flash. Full verified lists in
   [provider-discovery.md](provider-discovery.md).
8. **All run routes are acceptance criteria**: agent runs through the harness, prompt, completion,
   and chat runs, and LLM-as-a-judge. Pull request 4 in [plan.md](plan.md) owns this wiring.

## Decisions taken during this revision (agent, for founder review)

These were open decisions the founder had not answered directly. Each follows the draft
recommendation already recorded in this folder, and each is reversible before its pull request
lands.

1. **Done gating for providers without a free credential test:** Done enables when a credential is
   present and the credential status is `unknown`, with copy that says the key was saved untested.
   The founder's "manual model IDs in any case" comment supports not blocking these providers.
2. **Pin versus follow for the pre-checked default set:** Done saves the pre-checked defaults as
   the connection's explicit active list. Nothing changes a saved list silently.
3. **`anthropic/claude-opus-5` is listed as a default** even though the pinned Pi catalog still
   tops out at Opus 4.8. The implementation refreshes the generated catalog (sync-model-catalog);
   until then the effective Anthropic defaults are the identifiers that exist.
4. **OpenRouter default list contents** beyond the founder's named models (GLM-5.2, DeepSeek Pro
   and Flash): GPT-5.6 Luna, MiMo v2.5, and Tencent HY3, taken from the August 2026 OpenRouter
   usage rankings.
5. **Bedrock, Azure, and Vertex ship without pre-checked defaults** because their model access is
   account-specific (deployments and enabled foundation models). Their cards rely on discovery
   plus manual entry.

## Open decisions

1. Default connection selection when several connections exist for one provider and a saved
   configuration names only the provider.
2. Whether a later change should cache discovery results. The current recommendation keeps the
   first response temporary and stores only active models.
3. Whether connection-level harness choices belong in the vault payload or in a non-secret settings
   resource. The current proposal keeps them beside models because both configure the connection.
4. Provider discovery route shape and ownership.
5. A confirmed free credential-test endpoint for MiniMax and current Anyscale-based connections,
   if one exists.
6. Where the subscription model shortlist persists and which project owns it. Draft
   recommendation: a small non-secret per-project settings record owned by the runner
   subscription-status project; this folder only reserves the concept.

## Planning constraint

The feature-planning instructions request an interface-design skill for new contracts. That skill is
not available in this session. The draft manually separates identity, credentials, endpoint config,
model selection, user policy, and technical compatibility. A later review should use that skill if it
becomes available.
