# Tasks

Base branch: `release/v0.127.1`. Part A (backend) and Part B (frontend) can run in parallel.
Part B needs only the two field names from Part A, which this spec fixes. The end-to-end
checks in section 6 need both parts.

Local stack for every check: EE dev, `load-env hosting/docker-compose/ee/.env.ee.dev` then
`bash ./hosting/docker-compose/run.sh --ee --dev --build`. A real Composio event needs the
Composio key from the local-only EE env file and a GitHub account connected in the app.

## Part A: Backend

### 1. DTOs (no migration)

- [x] 1.1 Add `include_event: bool = True` to `TriggerSubscriptionData` in
  `api/oss/src/core/triggers/dtos.py`, after `inputs_fields`, with a one-line comment: adds the
  event data to the agent's message.
- [x] 1.2 Add `event: Optional[Dict[str, Any]] = None` to `TriggerDeliveryData`, after `inputs`.
- [x] 1.3 Unit test: a row dict without `include_event` validates to `True`; a dict with
  `false` round-trips through `map_subscription_dto_to_dbe_edit` and
  `map_subscription_dbe_to_dto` as `False`.

### 2. Inputs composition (pure function)

- [x] 2.1 In `api/oss/src/core/triggers/utils.py`, add
  `compose_event_inputs(inputs, *, context, include_event) -> Dict[str, Any]`. `context` is the
  event context from `_build_context`; the function reads `context["event"]`. It does not take
  the raw provider body, which `_run` also holds in a local named `event`. It coerces message
  text with the text rule (design decision 5) and adds the event text (design decision 3). It
  does not mutate its argument.
- [x] 2.2 Add `format_event_text(event_type, attributes) -> str` in the same file, used by 2.1.
- [x] 2.3 Unit tests in `api/oss/tests/pytest/unit/triggers/test_triggers_event_inputs.py`, one
  per scenario of `specs/trigger-event-inputs/spec.md`: string content, parts content, last
  message not user, `{}`, completion mapping, whole context, option off, no attributes, string,
  number, boolean, object, array, absent value. One test pins the exact text of the shared example in
  `design.md` decision 3. The value cases use the same fixtures as task 7.8.

### 3. Dispatcher

- [x] 3.1 In `_run` (`api/oss/src/tasks/asyncio/triggers/dispatcher.py:311-348`), for a
  subscription, call `compose_event_inputs` on the resolved inputs, then use the result for both
  `delivery_data.inputs` and the request. Set `delivery_data.event = context["event"]`.
  Schedules keep today's inputs, with no coercion and no `event`.
- [x] 3.2 In the test-mode branch (`dispatcher.py:156-188`), do the same, so the test delivery
  has the composed inputs and `event`.
- [x] 3.3 Keep `data.event` on the failed-build delivery (`dispatcher.py:433-443`): set it as
  soon as the context is built, before the mapping resolves, so a failed run still shows the
  event.
- [x] 3.4 Update `api/oss/tests/pytest/unit/triggers/test_triggers_dispatcher.py`: the happy path
  with a `messages` mapping gets the event text; the existing `{"number": ...}` tests stay
  unchanged; a schedule run has no `event`; the test capture has `event`.

### 4. Builder agent guidance

- [x] 4.1 In `_TRIGGER_INPUTS_REFERENCE`
  (`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:518-650`), replace the sibling
  `"event": "$.event.attributes"` advice with: the agent reads only `messages`; the event is
  included in the last user message by default (`include_event`); set `include_event: false` to
  send the instruction alone; to put one field inside the text, use text parts with a selector
  per part. Fix both example payloads. The `inputs_fields` description of the
  `create_schedule` and `create_subscription` tools
  (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`, `_TRIGGER_INPUTS_FIELDS_SCHEMA`)
  gives the same sibling-key advice; fix it the same way.
- [x] 4.2 Run the SDK unit tests that pin this text, if any (`git grep -n "_TRIGGER_INPUTS_REFERENCE" sdks/python`).

### 5. Backend checks

- [x] 5.1 `cd api && ruff format && ruff check --fix` and the same in `sdks/python`, with the
  system ruff.
- [x] 5.2 `cd api && py-run-tests` for the triggers unit tests; all pass.
- [x] 5.3 Local stack: create an event subscription through the API with
  `inputs_fields = {"messages":[{"role":"user","content":"Say the PR title."}]}` and no
  `include_event`. `GET` it: `data.include_event` is `true`.
- [x] 5.4 Local stack: post one signed Composio event for that subscription (the recipe in
  `api/oss/tests/pytest/acceptance/triggers/test_triggers_ingress.py`, test
  `test_duplicate_event_id_writes_single_delivery`). Query `/triggers/deliveries/query`: the
  delivery has `data.event.attributes`, and `data.inputs.messages[0].content` ends with the
  event text.
- [x] 5.5 Local stack: open the session of that delivery. The agent's reply uses the PR title.

## Part B: Frontend

### 6. Types and generated client

- [x] 6.1 Add `include_event: z.boolean().nullish()` to `triggerSubscriptionDataSchema` and
  `event: z.record(z.string(), z.unknown()).nullish()` to `triggerDeliveryDataSchema` in
  `web/packages/agenta-entities/src/gatewayTrigger/core/types.ts`.
- [x] 6.2 After Part A is merged on the local EE stack, regenerate the Fern client:
  `bash ./clients/scripts/generate.sh --language typescript --local` against the EE dev stack.
  `git diff` must show only `TriggerSubscriptionData.ts` and `TriggerDeliveryData.ts` changed
  (plus any generated docs for them). Then `pnpm --filter @agentaai/api-client build`.

### 7. Pure helpers in `@agenta/entities/gatewayTrigger/core` (parallel with 8)

- [x] 7.1 `eventFields.ts`: `eventFieldsFromSchema(payloadSchema)` returns one flat list of fields
  (key, selector, label, description) per design decision 7. `fieldLabel(path)` splits camelCase and
  calls `humanizeActionKey`.
- [x] 7.2 `eventMessageTemplate.ts`: `parseMessageTemplate` ignores keys other than the message
  key and returns `string | null`, where `null` means the composer cannot show the mapping
  (design decisions 8 and 10). `compileMessageTemplate` takes the stored `inputsText`, replaces
  only the message key and keeps the rest. For the `messages` key, a template with a pill is
  always stored as text parts, even a single pill alone (design decision 10). Add
  `templateSelectors(template)` for the used-tag check.
- [x] 7.3 `eventMessageTemplate.ts`: `remapMessageTemplate(inputsText, prev, next)`
  moves a template to the new input shape with `parseMessageTemplate` and
  `compileMessageTemplate`, removes the old key, keeps sibling keys, and returns a mapping it
  cannot show unchanged (design decision 10).
- [x] 7.4 `eventPreview.ts`: `renderMessagePreview(template, event, labels, includeEvent)`
  returns the whole text the agent gets. `labels` maps a selector to its tag label. It fills
  pills from `{event}` with `resolveSelectorPreview` and the text rule of design decision 5
  (`null` or `undefined` gives `""`), else `[Label]`. When `includeEvent` is on and `event` has
  attributes, it adds `formatEventText(event.event_type, event.attributes)`, which mirrors the
  backend format. The preview and Run now both call `renderMessagePreview`.
- [x] 7.5 `selectorPreview.ts`: `resolveSelectorPreview` keeps a quoted key whole, so
  `$.event.attributes["a.b"]` reads the key `a.b` (today it splits at the dot, line 36).
- [x] 7.6 `latestDeliveryEvent.ts`: the pure `latestDeliveryEvent(deliveries)` returns
  `data.event` of the newest delivery that has one, or `null`. The endpoint does not return
  rows newest first, so it sorts them itself.
- [x] 7.7 Export the new functions from `web/packages/agenta-entities/src/gatewayTrigger/index.ts`.
- [x] 7.8 Vitest tests in `web/packages/agenta-entities/tests/unit/`: the GitHub pull request
  schema gives seven fields with the right labels; a Linear-style nested `data` gives one field
  per child, labelled with the object's name first;
  bracket selectors and a quoted key with a dot; sibling keys kept on write; text plus a pill
  moved from a completion shape to a chat shape by `remapMessageTemplate`; `latestDeliveryEvent`
  on unsorted rows; preview with and
  without an event; the value fixtures of design decision 8 (string, number, boolean, object, array,
  absent) give the same text as the backend tests; the shared example string from `design.md`
  decision 3 is equal to `formatEventText` output.

### 8. Components in `@agenta/entity-ui/gatewayTrigger` (parallel with 7)

- [x] 8.1 Restore `PillEditor.tsx` from `git show 89c2d80c39^:web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/subscription/PillEditor.tsx`
  and adapt it: pills show `fieldLabel`, not the raw path.
- [x] 8.2 `EventMessageComposer.tsx`: the pill editor over `inputsText`, using
  `parseMessageTemplate` and `compileMessageTemplate`; keeps the warning line that
  `MessageComposer` shows for a mapping it cannot represent.
- [x] 8.3 `EventFieldTags.tsx`: a wrapping row of small tags inside the instruction box, the
  description in a tooltip on hover and focus, the check on used tags, and a click handler that
  inserts a pill.
- [x] 8.4 Export both from `web/packages/agenta-entity-ui/src/gatewayTrigger/index.ts`.

### 9. Wiring in `@agenta/automation-ui`

- [x] 9.1 `AutomationInstructionField`: new props `kind`, `connectionId`, `eventKey`,
  `includeEvent`, `onChangeIncludeEvent`, `automation` (null on the create screen). It calls
  `useAutomationRuns(automation)` and `latestDeliveryEvent(runs)` to find the newest event.
  For `kind === "event"`, the shape effect calls `remapMessageTemplate` instead of
  `remapMessageShape`, and the field renders `EventMessageComposer`, `EventFieldTags`, the checkbox, and the preview. Resolve
  `integration_key` from `useTriggerConnectionsQuery()` by `connectionId`, then
  `useTriggerEvent(integrationKey, eventKey)`. Schedules render `MessageComposer` as today.
- [x] 9.2 `useAutomationCreate.ts` and `useAutomationDraft.ts`: add `includeEvent` to the
  draft (seed from `data.include_event ?? true`), a setter, and the `sameDraft` comparison.
- [x] 9.3 `automationEdit.ts`: `AutomationPatch.includeEvent`; `subscriptionEdit` and
  `buildAutomationCreate` write `data.include_event`. `AutomationCreateDraft` carries it.
- [x] 9.4 `AutomationCreateBody.tsx` and `AutomationDetailBody.tsx`: pass the new props. The
  create screen has no automation yet, so it has no delivery and the preview shows labels.
- [x] 9.5 UI copy comes from the approved mockup. Do not write new copy.

### 10. Run now in `web/mobile`

- [x] 10.1 `AutomationTestRunButton.tsx` and `AutomationActionsMenu.tsx`: build the text with
  `renderMessagePreview`, the same call the preview makes. On press, await
  `queryTriggerDeliveries({subscription_id})` and pass the rows to `latestDeliveryEvent`; on a
  failed call, log the error and do not start. For a mapping
  the composer cannot show, send today's text from `getScheduleMessagePreview`. Keep
  `testRunBlockedReason`.
- [x] 10.2 Unit test for the text Run now sends: with a delivery, with none, with a failed
  deliveries call (no run), and with a mapping the composer cannot show (today's text).

### 11. Frontend checks

- [x] 11.1 `cd web && pnpm lint-fix`; type check passes for `@agenta/entities`,
  `@agenta/entity-ui`, `@agenta/automation-ui` and `web/mobile`.
- [x] 11.2 Run the package unit tests for `@agenta/entities` and `@agenta/automation-ui`.
- [ ] 11.3 Local stack, `/m`, create flow: new event automation on the GitHub pull request
  event. The seven tags show; hovering one shows its description. Click "Title": a pill appears,
  the tag shows a check. The checkbox is checked. Create. `GET` the subscription: the stored content has the
  `$.event.attributes.title` part and `data.include_event` is `true`.
- [x] 11.4 Local stack, `/m`, detail flow: open an automation created before this change. The
  checkbox is checked. Uncheck, Save, reload: unchecked. Discard brings back the saved value.
- [ ] 11.5 Local stack, `/m`, session workspace: the automation drawer shows the same field.
- [ ] 11.6 Local stack: after the event from 5.4, the preview shows the real title in the pill
  and the event JSON. Run now opens a chat whose first message has the title.
- [x] 11.7 Phone width (390 px): the tag row wraps and the page has no
  sideways scroll.

## 12. QA evidence

- [ ] 12.1 Record one real GitHub pull request payload from a real delivery, compare its
  keys with the catalog schema, and note its size in characters. Write the result in the build's research file. If keys differ,
  open a follow-up issue; do not block this change.
