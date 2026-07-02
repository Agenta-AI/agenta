# Custom providers and model auth for the Pi harness

Make provider plus model selection work end to end for the Pi harness, including custom
providers. A user picks a model and a provider for a Pi agent. Built-in providers work once a
`provider_key` is stored (OpenRouter works this way today: Pi ships 253 built-in OpenRouter
models and reads `OPENROUTER_API_KEY`). Custom providers do not work, models drop silently, and
one provider is misnamed. This project closes those gaps.

## The shape in one paragraph

Two sibling projects already own most of the mechanism. `provider-model-auth` (BUILT, PR #4815)
owns the connection resolver, the harness capability table, and clear-then-apply credential
injection. `model-config` (DESIGNED, not built) owns the Pi `auth.json`/`models.json` write, the
fail-loud unsettable-model path, and the model-choice surface. This project sits on top of both.
It fixes the one resolver line that mislabels a known-direct custom provider as a non-`direct`
deployment (which the Pi capability gate rejects), builds the model-config `auth.json`/`models.json`
write in the runner so a custom base URL and genuinely custom model ids reach Pi, makes a
dropped model fail loud, surfaces a project's custom-provider models in the frontend picker, and
corrects the Together env var name. No new wire field, no vault storage change.

## The five gaps

1. Deployment gate blocks a known-direct custom provider (server-side, the fastest unblock).
2. The runner never teaches Pi a custom provider (no `models.json` write).
3. A requested model that cannot be set drops silently and returns HTTP 200 on the wrong model.
4. The frontend picker never shows a project's custom-provider models.
5. Together's env var name is wrong, so a Together key silently fails.

## Read in this order

1. [context.md](context.md): why this exists, what is already built, goals, non-goals.
2. [research.md](research.md): the five gaps with verified file and line references, the two
   path corrections this session found, and the startup-banner appendix.
3. [design.md](design.md): the contract analysis. Every field this plan defines or changes is
   classified by semantic role (the `design-interfaces` pass on paper).
4. [plan.md](plan.md): the sliced plan, mapped to gaps, with the recommended order and tests.
5. [status.md](status.md): current state, decisions, open decisions, risks.

## Builds on

- [../provider-model-auth/](../provider-model-auth/): the connection resolver, the
  `ResolvedConnection` contract, the harness capability table, and the runner clear-then-apply.
  This project extends its `deployment` classification and consumes its resolved connection.
- [../model-config/](../model-config/): the Pi per-run `auth.json`/`models.json` write (Part 1),
  fail-loud on an unsettable model (Part 2), and model choices per harness (Part 3). This project
  implements Parts 1 and 2 and extends Part 3 to include the vault's custom-provider models.
</content>
</invoke>
