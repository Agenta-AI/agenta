# model-providers: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements.

## Words used in this file

- **View**, **container**, **root**, **right panel**: as defined in the `agent-panel` spec. **Draft**: the production draft store of the agent configuration (`workflowDraftAtomFamily`); auto-save commits it as a new version about 1500 ms after a change (`web/packages/agenta-playground/src/state/execution/agentAutoCommit.ts:27`), as production does. A container shows a root (its base screen, not in the stack) and up to two views on top of it (depth 1 and depth 2).
- **`apply`** and **`target`**: the two settings of a view in the view stack contract (design.md D2). `apply: "immediate"` means a change reaches the target at once and the view has "Done". `apply: "on_save"` means the view has "Cancel" and "Save", and only Save writes. `target: {kind: "agent_draft", revisionId}` writes the agent configuration through the production draft store, and auto-save saves it as a new version; `target: {kind: "project"}` writes a project resource on the server.
- **`useViewTitle`**: the hook a view calls to put its own title in the breadcrumb. Params carry addresses only, never names.
- **`DrawerViewChrome`**: the container chrome that draws a view inside a drawer shell, for a host that keeps a drawer (design.md D2).
- **Connection**: one stored credential for one model provider in the project vault, with its name, its **active models** (the models the picker offers) and its **harnesses**.
- **Harness**: the runtime that runs an agent turn: Pi, Claude Code or Codex.
- **Subscription**: a person's ChatGPT or Claude plan that agents run on, connected by a sign-in instead of an API key.
- **Built-in models**: the models Agenta serves on its own provider account. The list row for them is named "Agenta".
- **Probe**: the API call `POST /providers/probe`. It tests a credential and fetches the provider's model list in one call. It never stores anything.
- **Key check**: the probe that the form starts by itself. There is no "Test" button.
- **Credential status**: the probe's answer about the key: `valid`, `invalid` or `unknown`. `unknown` means Agenta has no free way to prove the key.
- **Discovery status**: the probe's answer about the model list: `fetched`, `unsupported` (the provider has no list) or `failed` (the list did not come back).

## Milestones and views

- First configuration slice, task 4.2 (`tasks.md`): the Model view with `apply: "immediate"`, target `agent_draft`. A pick changes the agent configuration with no Save, and auto-save saves it. The list stays today's list.
- Model picker and provider list, tasks 13.1 and 13.2: the grouped Model view (requirement "Model picker as one grouped list"), the Model providers list, the add view, and the built-in card as a view.
- Provider key forms, tasks 14.1 to 14.3: the form layout, the automatic key check, the per-provider forms, the probe plumbing ("Stop"), and the other mounts (run error drawer, onboarding, connect-model strip, credit strip).
- Subscriptions, task 15.1: ChatGPT device code and the Claude token.
- Built-in models on and off per project is not part of this work (decided by Mahmoud): it comes as its own backend change. The built-in card (task 13.2) lists the three models with no switches.

| View | `apply` | `target` | Where Save writes |
|---|---|---|---|
| Model view | `immediate` | `agent_draft` | each pick writes the agent configuration; auto-save saves it |
| Model providers list | `immediate` (no form) | `project` | nothing; it opens forms |
| Add a provider or subscription (list, then the form or sign-in step) | `on_save` in the form step | `project` | the project's connection on the server |
| Provider form (Edit) | `on_save` | `project` | the project's connection on the server |
| Built-in card | `immediate` (no form, "Done") | `project` | nothing |

The stack holds two levels (design.md D2). In the panel, "Manage model providers" calls `open` and replaces the Model view, so the list is at depth 1 and a form is at depth 2. A form chosen from the add list is a step inside the add view, not a third level. The canvas draws the breadcrumb "Agent › Model › Model providers" (F09 f1), which needs three levels; the spec uses "Agent › Model providers". Open question for Mahmoud.

The generic unsaved-changes dialog lives in `@agenta/ui` with keys under `ui.viewStack`; its description comes from the view (`ViewForm.leaveDescription`). Production has only the agent draft text "Save your changes to this agent draft, or discard them?" (`web/packages/agenta-i18n/locales/en/entityUi.configItems.json:31`). A provider form saves to the server, so it needs its own description: text not written; listed for Mahmoud.

## Today's behavior (origin/main 5d783fec, v0.129.0)

- The model picker is a two-column popover, at least 460 px wide (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ModelPickerControl.tsx:237-259`). "Manage model providers" is its footer row (`:258`, text `web/packages/agenta-i18n/locales/en/ui.llmProvider.json` key `manageProviders`). Loading shows "Loading models…" and an empty project shows "Set up model providers" (`ModelPickerControl.tsx:206-229`). Built-in rows are named "Built-in: {slug}" (`web/packages/agenta-entities/src/secret/core/agentModelCandidates.ts:558`).
- The provider drawer is 480 px wide (`web/packages/agenta-entity-ui/src/secretProvider/ProviderDrawer.tsx:148`). It holds the catalog list (`:400`), the subscription cards (`:408-418`) and the connection card (`:426`).
- The connection card tests on a "Test" button (`web/packages/agenta-entity-ui/src/secretProvider/ProviderConnectionCard.tsx:531-545`). A new edit drops the last result (`:428-434`). The save is gated by `doneState` (`web/packages/agenta-entities/src/secret/core/connections.ts:808-833`): `invalid` blocks, `valid` enables, `unknown` enables with "This provider offers no free credential check, so the key is saved untested.", and an unchanged stored key enables. The models section shows as soon as a credential is filled (`ProviderConnectionCard.tsx:362-366`). Name is marked optional today (key `nameOptional`, `entityUi.providerConnection.json:18`); the design makes it required.
- Model list: 60 rows, then "Show all {{total}}" (`web/packages/agenta-entities/src/secret/core/cardCopy.ts:38`, `entityUi.providerConnection.json:34`). Typed id: "Add {{term}}" (`:29`). The refresh line is "Fetched {{time}} ·" with "Re-fetch" (`:35-36`); the design renames these to "List updated just now ·" and "Update".
- Pi (`pi_core`) is the default harness when it supports the provider (`web/packages/agenta-entity-ui/src/secretProvider/useSaveProviderKey.ts:21`, `ProviderConnectionCard.tsx:348-354`).
- Built-in models: `AGENTA_MODELS` in `api/oss/src/core/gateways/llms/catalog.py:41-45`. The endpoint exists only when the deployment has Agenta's Vertex account (`catalog.py:174-177`). No per-project setting exists. The `projects` table has no settings column (`api/oss/src/models/db_models.py:92-120`).
- ChatGPT sign-in: the browser polls the attempt every `max(pollAfterMs, 2000)` ms and stops after 15 minutes (`web/packages/agenta-entities/src/secret/state/subscriptionLogin.ts:52-66`, `web/packages/agenta-entities/src/secret/api/loginAttempts.ts:24-27`). The server takes the runner's interval with a 2000 ms floor (`api/oss/src/core/secrets/subscription_login.py:35, 81-84`). So the wait after the person enters the code is about one poll interval, not a minute. "up to a minute" is a guess (HANDOFF hidden logic 17).
- Production texts kept: `web/packages/agenta-i18n/locales/en/entityUi.subscriptionSignIn.json` lines 3, 12, 13, 22-25, 27, 28, 30; `entityUi.providerConnection.json` lines 2, 21, 24, 25, 28, 29, 34; `settings.providers.json` key `customEndpointHint`.

## The probe, verified

- Route: `POST /providers/probe` (`api/oss/src/apis/fastapi/providers/router.py:100-106`). Body: `kind`, `provider` (key, url, version, extras), `secret_id`, `secret_scope` (`api/oss/src/apis/fastapi/providers/models.py:14-54`).
- A saved key is tested without resending it: the body names `secret_id`, the server reads the stored credential, and typed fields override stored ones (`router.py:108-172, 213-222`). The frontend already does this when no secret field is typed (`connections.ts:310-321`). So the check on opening an existing connection needs no backend work.
- Limits of the saved-key path: a managed secret answers 409 "Managed secrets cannot be probed." (`router.py:144-148`). A change of `kind` without a typed key answers 422 (`router.py:156-163`). An unknown `secret_id` answers 404 (`router.py:138-142`).
- Access: `EDIT_SECRET` for project connections; `VIEW_SECRET` for an organization connection tested as saved; changed fields on an organization connection need an organization owner or admin (`router.py:176-211`).
- Cost: the probe never sends a generation request; each adapter makes one free read of a model list (`api/oss/src/core/providers/adapters.py:1-12`). OpenRouter makes two reads (`api/oss/src/core/providers/service.py:61-63`).
- Timeout: 10 seconds for the whole probe, no retries (`service.py:22, 53-67`). A timeout answers `unknown` with "Could not reach {label} in time." and discovery `failed` (`service.py:68-79`). The generated client's own timeout is 30 seconds by default (`web/packages/agenta-api-client/src/generated/api/resources/secrets/client/Client.ts`, `timeoutMs`).
- Rate limits: the route has no limit of its own. In EE it falls in the catch-all `standard` throttle category (`api/ee/src/core/access/entitlements/types.py:179-206`), which on the Hobby plan has capacity 480 and refills 480 per minute (`types.py:394-404`, unit at `:134-136`). Whether the bucket is per organization or per user: not verified. No throttle was found for OSS (not verified beyond a search). The automatic check adds at most one probe per paste, per blur with a changed key, per opening of a connection and per "Update", so it stays far below the limit.
- Per adapter: 401 or 403 means `invalid` (`adapters.py:107-114`). An OpenAI-compatible endpoint maps 404 or 405 to discovery `unsupported` with credential `unknown` (`adapters.py:365-399`). Bedrock with access keys answers `unknown`, discovery `unsupported` (`adapters.py:401-437`, message at `:426`). Vertex always answers `unknown`, discovery `unsupported` (`adapters.py:439-457`). MiniMax, Anyscale, Aleph Alpha and SageMaker always answer `unknown` (`adapters.py:278-287, 519-534`). DeepInfra and Perplexity read a public list and answer `unknown` (`adapters.py:255-276`).
- A missing or refused base URL (for example a private address) answers 422 with the reason (`api/oss/src/core/providers/endpoints.py:35-53`, `router.py:233-239`). An unknown `kind` answers 422 too (`service.py:47-51`).
- Server messages are English text built in the adapters. They are not translated. The new form should map the statuses to the canvas texts and send the server message to the logs.

## Backend work

- Automatic key check: none. The probe already tests a saved key by `secret_id`.
- "Stop": frontend only. The generated client accepts `abortSignal` (`Client.ts`, `abortSignal: requestOptions?.abortSignal`), but `probeProvider` does not pass one (`web/packages/agenta-entities/src/secret/api/probe.ts:68-94`). Small (under one day). The server finishes its one read anyway; that is harmless.
- Vertex test and model list: needs `google-auth` in the API (TODO at `adapters.py:440-448`). Medium. The approved design does not ask for it: the form shows the `unknown` state (requirement "Key that cannot be proved").
- Bedrock access-key test: needs SigV4 signing with `botocore` (TODO at `adapters.py:402-409`). Medium. The approved design does not ask for it: the form shows the `unknown` state.
- Built-in models on or off per project: not part of this work (decided). It is its own backend change outside this program.
- Readable names for ids with no provider name: the probe returns `model_names` only where the provider gives them (`api/oss/src/core/providers/dtos.py:53-56`). Building names for the rest is new work in the frontend. Small. Not verified that the design needs it beyond the drawn rows.

## Other places that mount the changed components

Verified on origin/main.
- `ProviderDrawer`: `web/packages/agenta-settings-ui/src/providers/ProvidersPanel.tsx:438`; `ModelPickerControl.tsx:196`; `web/packages/agenta-entity-ui/src/secretProvider/useLLMProviderConfig.tsx:119` (used by `web/mobile/src/features/chat/DrillInBridgeProvider.tsx:45`); `web/packages/agenta-entity-ui/src/clientTools/GatewayConnectToolWidget.tsx:76` (chat tool widget, `clientTools/registry.tsx:41`); `web/mobile/src/features/chat/ConnectModelStrip.tsx:51` (mounted at `LiveConversation.tsx:1064`); `web/mobile/src/features/chat/RunErrorProviderDrawer.tsx:21` (loaded at `RunErrorRecovery.tsx:17, 101`); `web/mobile/src/features/wallet/CreditAlertStrip.tsx:118` (mounted at `LiveConversation.tsx:1072`).
- `ProvidersPanel` and `AIProvidersPage`: `AIProvidersPage.tsx:158`, mounted by `web/mobile/src/features/settings/LlmProvidersTab.tsx:65`.
- `SubscriptionConnectionCard` and `SubscriptionSignInDialog`: `ProviderDrawer.tsx:408`; `ProvidersPanel.tsx:426`; onboarding `web/mobile/src/features/onboarding/OnboardingCreditsStep.tsx:229, 237`.
- `ModelPickerControl`: `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx:526`.
- `SelectLLMProviderBase` (only if the shared picker list changes): `ModelPickerControl.tsx:237`; `useModelHarness.tsx:480`; `GroupedChoiceControl.tsx:117`; `ModelConfigEditor.tsx:144`; `CustomProviderForm.tsx:422`; the composer "/model" in `web/mobile/src/features/chat/Composer.tsx:350`.
- `ModelSetupBanner` opens the provider setup: `web/mobile/src/features/chat/ConfigPane.tsx:73`; `LiveConversation.tsx:1066`.
- Phone: M12 (Model providers at full width) uses the same views; see the `phone-layout` spec.

## Duplicate implementations to merge

- Provider key entry: `web/mobile/src/features/onboarding/OnboardingKeyForm.tsx:51` saves a key with no probe (`:82`), next to `ProviderConnectionCard`. Merge into the new form, or keep the onboarding row and add the automatic check. Decision for the milestone owner.
- `ProviderCredentialsSectionView` (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ProviderCredentialsSectionView.tsx:287`) is used only by a Storybook story (`web/storybook/stories/entity-ui/ProviderCredentialsSection.stories.tsx:7`). Delete it.
- Two provider lists: the Settings list in `ProvidersPanel.tsx` and the catalog in `ProviderCatalogList` inside the drawer. The two-screen design replaces both.

## States described but not drawn

Provider cannot be reached on opening; the `unknown` result; the time-out result; no model checked; typed id "Add"; more than 60 models; Sign-in failed, expired code and connected for ChatGPT; "Checking…" and failure for Claude; empty list (only "Agenta"); add-list search with no match; picker search with no match and loading; loading and error of the list; the save in flight. Each is a scenario above. The texts for "provider cannot be reached", for the `unknown` reasons other than the production `doneState` note, and for the list error are not drawn and not in production. They need text from Mahmoud before release. The description of the unsaved-changes dialog for a provider form is not written either.

## Text that is not confirmed (HANDOFF section 5)

- "Agenta checks the key as soon as you paste it.", "Checking the key with OpenAI…", "The key works. Agenta found 42 models.", "OpenAI did not accept this key. Check that you copied all of it, then paste it again.", "Next: choose the models. This part shows when the key works.", "Save connection", "List updated just now", "Update", "Provided by Agenta".
- Bedrock: "Sign in with", "One Bedrock API key.", "An access key ID and a secret access key."
- ChatGPT: "Waiting for ChatGPT to confirm" and its paragraph; "Copied" in this place.
- New canvas text that is not in production and not in that list: "Add a provider or subscription", "Use a subscription", "Use an API key", "Subscriptions", "API keys", "Sign in needed", "Updating the list…", "Paste your OpenAI API key", "Paste a new key to replace sk-••••f2K", "Leave blank to keep the key.", "Active models · 3 of 42", "Active models · 2 of 3" (built-in card).

## Open questions

- Delete inside the edit form: the orchestrator chose to keep delete in Settings (OPEN-QUESTIONS group 2). Mahmoud can overturn it.
- The ChatGPT waiting text says "up to a minute"; the code polls every few seconds. Confirm the text.
- The panel breadcrumb for Model providers: "Agent › Model providers" (two levels, as the spec says) or the canvas "Agent › Model › Model providers" (needs a third level).
