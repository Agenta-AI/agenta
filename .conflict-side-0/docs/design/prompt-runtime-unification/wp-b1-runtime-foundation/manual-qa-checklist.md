# Manual QA Checklist

End-to-end checks for everything WP-B1 ships, plus the rendering review pass. The unit suite (309 tests) already covers the per-helper behavior; this list is the human-in-the-loop pass against a real stack with real models.

Group A is **new functionality** that this PR enables. Groups B–D are **regression** — these were working before and need to keep working.

Each item lists where to test (UI / direct call), what to do, and what to expect. Tick boxes as you go.

---

## A. Custom and self-hosted models in LLM-as-a-judge (new)

The headline change: judges can now use any model the user has configured in Model Hub, not just a fixed provider key set.

### A1. Custom OpenAI-compatible model — UI path

- [ ] Configure a custom OpenAI-compatible model in Model Hub (e.g., a local vLLM, an internal proxy, or a third-party gateway).
- [ ] Create a new LLM-as-a-judge evaluator. In the model picker, select the custom model.
- [ ] Save / commit the evaluator.
- [ ] In the evaluator playground, run it against a sample testcase.
  - **Expected**: completes without error. Result has the same shape as before (score / success, or whatever the prompt produced).
- [ ] Re-open the saved evaluator. The custom model should still be selected.
  - **Expected**: model field round-trips through nest/flatten transforms.

### A2. Self-hosted model — UI path

- [ ] Configure a self-hosted model (Ollama, llama.cpp server, internal HTTP endpoint).
- [ ] Same flow as A1.
- [ ] Run it via the evaluation service (offline) over a small testset.
  - **Expected**: evaluation completes, results show in the run view.

### A3. Standard provider — UI path (regression)

- [ ] LLM-as-a-judge evaluator with a standard model (`gpt-4o-mini`, `claude-3-5-sonnet`, `gemini-1.5-flash`, etc., depending on what's wired up).
- [ ] Run in the evaluator playground.
- [ ] Run via the evaluation service (offline) over a testset of 5–10 rows.
  - **Expected**: identical to pre-PR behavior. No new error messages, no missing fields.

### A4. Standard provider — direct call (regression)

- [ ] Hit the evaluator workflow endpoint directly from `curl` / `httpx`:
  ```
  POST /api/.../workflows/auto_ai_critique_v0/run
  ```
  with a payload referencing a standard model.
  - **Expected**: same response shape as before. `score` / `success` fields populated.

### A5. Custom model — direct call (new)

- [ ] Same as A4 but with a custom-provider model name.
  - **Expected**: succeeds. Pre-PR this would have failed because the judge bypassed the custom-provider resolver.

### A6. Missing secrets — both UI and direct call

- [ ] Configure a custom model but remove its API key from the workspace secrets.
- [ ] Run an evaluator that uses it.
  - **Expected**: clear error message identifying the model. The new code raises `InvalidSecretsV0Error` with the selected model name. The user-visible message should mention the model so they know which secret to add.

### A7. Reasoning / temperature-allergic models

- [ ] Pick a model that previously errored on `temperature` (e.g., OpenAI `o1`-family, some reasoning models) — the judge used to send a hard-coded `temperature=0.01`.
- [ ] Run the judge against a testcase.
  - **Expected**: succeeds. Pre-PR the call would have errored with "unsupported parameter `temperature`".

---

## B. Variable rendering — chat / completion (regression)

Chat and completion share the same `PromptTemplate.format` path. After WP-B1 they go through the new `render_template` helper. Behavior must be unchanged for end users.

### B1. Curly mode — top-level + nested + array

- [ ] In the playground, create / pick a completion app with `template_format: curly`.
- [ ] Set messages like:
  ```
  Hello {{name}}.
  Profile: {{profile}}
  Profile name: {{profile.name}}
  First tag: {{profile.tags.0}}
  ```
- [ ] Send `name="Ada"` and `profile={"name": "Ada", "tags": ["x","y"]}` (object value).
  - **Expected**: in the rendered prompt sent to the model, `{{profile}}` is the compact JSON, `{{profile.name}}` is `Ada`, `{{profile.tags.0}}` is `x`.
- [ ] Repeat for chat — same template patterns in a system / user message.

> **Note**: in the playground today, object values may still be JSON-stringified before transport (`normalizeCompact`). Nested access through the playground may not work until WP-F2 lands. This is expected and tracked separately.

### B2. Curly mode — JSONPath and JSON Pointer

- [ ] Same app, template:
  ```
  JSONPath: {{$.profile.name}}
  JSON Pointer: {{/profile/name}}
  ```
- [ ] Send the same `profile` object.
  - **Expected**: both render to `Ada`. (If `python-jsonpath` is not installed in the SDK image, both fall back to error with an install hint — verify the image has it.)

### B3. Curly mode — literal-key-first

- [ ] Set context with a key that contains a dot: `{"topic.story": "linear-algebra"}`.
- [ ] Template: `{{topic.story}}`.
  - **Expected**: renders as `linear-algebra`. The literal key wins over nested traversal.

### B4. Curly mode — same variable repeated

- [ ] Template: `Hi {{name}}, welcome {{name}}.`
- [ ] Send `name="Ada"`.
  - **Expected**: both occurrences replaced.

### B5. Curly mode — multiple distinct variables

- [ ] Template uses 3+ different variables in one message.
- [ ] All resolve.

### B6. Curly mode — whitespace tolerance

- [ ] Template uses `{{ name }}`, `{{   name   }}`, `{{name}}` mixed.
  - **Expected**: all resolve identically.

### B7. Curly mode — unresolved placeholder error

- [ ] Template references a variable not provided in inputs.
  - **Expected**: error message names the missing variable. Frontend should surface a readable error rather than a 500.

### B8. Fstring mode

- [ ] App with `template_format: fstring`.
- [ ] Template: `Hello {name}. Show literal: {{}} and {{escaped}}.`
- [ ] Send `name="Ada"`.
  - **Expected**: `Hello Ada. Show literal: {} and {escaped}.`

### B9. Jinja2 mode

- [ ] App with `template_format: jinja2`.
- [ ] Template:
  ```
  Hello {{ name | upper }}.
  {% if score >= 0.5 %}pass{% else %}fail{% endif %}
  Literal: {% raw %}{{ x }}{% endraw %}
  ```
- [ ] Send `name="ada"`, `score=0.7`.
  - **Expected**: `Hello ADA. pass Literal: {{ x }}`.

### B10. Jinja2 sandbox (security regression)

- [ ] In a chat / completion app with `template_format: jinja2`, set a message containing:
  ```
  {{ lipsum.__globals__['os'].popen('id').read() }}
  ```
- [ ] Run.
  - **Expected**: clear error from the sandbox. No shell command executed. `PromptTemplate` raises `TemplateFormatError`; the UI should show a sanitized error.

### B11. Bug-fix verification — backslash round-trip

- [ ] App with `template_format: curly`.
- [ ] Template: `path={{p}}`.
- [ ] Send `p="C:\\Users\\Ada"` (one backslash between segments at the wire level — i.e., a Windows-style path string).
- [ ] Inspect the rendered prompt on the trace.
  - **Expected**: `path=C:\Users\Ada` with single backslashes.
  - **Pre-PR behavior**: would have shown `path=C:\\Users\\Ada` (doubled). Compare to a release-branch instance if you want to see the old behavior.

### B12. Bug-fix verification — empty placeholder

- [ ] App with `template_format: curly`.
- [ ] Template includes `{{}}` somewhere (intentional or accidental — e.g., a copy-paste error).
- [ ] Run.
  - **Expected**: clear error like "Template variables not found or unresolved: ." (empty name). UI surfaces the failure.
  - **Pre-PR behavior**: silently rendered the entire input dict as JSON into the prompt. **Important**: on a stack with secrets in the render context, the pre-PR build would have leaked them. Verify the leak is gone.

---

## C. Variable rendering — LLM-as-a-judge (regression)

The judge funnels through the same helper but has a richer render context.

### C1. Offline evaluation — full variable matrix

- [ ] Create a testset with columns: `question`, `correct_answer`, plus a JSON column like `metadata`.
- [ ] Configure an upstream completion app that produces an output (so `outputs` / `prediction` is populated).
- [ ] Configure an LLM-as-a-judge whose `prompt_template` references:
  - `{{question}}` (top-level testcase key)
  - `{{inputs.question}}` (via the `inputs` alias)
  - `{{outputs}}` and `{{prediction}}` (both should bind)
  - `{{ground_truth}}`, `{{correct_answer}}`, `{{reference}}` (all aliases of `inputs[correct_answer_key]`)
  - `{{metadata.subfield}}` (nested access into the JSON column)
  - `{{parameters.threshold}}` (judge config visible to the prompt)
- [ ] Run an offline evaluation over the testset.
  - **Expected**: every variable resolves on every row. Inspect a few traces to confirm.

### C2. Online evaluation — trace-driven inputs

- [ ] Have the same evaluator subscribed online (so it runs on incoming traces).
- [ ] Send an invocation that produces a trace with recorded inputs and outputs.
- [ ] Verify the judge ran and the variable matrix resolved against the trace's `ag.data.inputs` / outputs.
  - **Expected**: same resolution behavior as offline, sourced from the trace.

### C3. Evaluator playground

- [ ] Open the evaluator playground for the same judge.
- [ ] Use a chained app run to populate `outputs` / `trace`.
- [ ] Run.
  - **Expected**: same resolution behavior. (Object-typed testcase columns may still arrive stringified — known WP-F2 issue.)

### C4. Judge — Jinja2 silent-return contract (regression)

- [ ] Set the judge's `template_format` to `jinja2` and put a sandbox-violating payload in the prompt template.
- [ ] Run.
  - **Expected (WP-B1 contract)**: judge logs a warning and returns the original content. No exception. (Chat/completion is the opposite: it raises. WP-B2 will align them.)

### C5. Judge — bug-fix verification (backslash + empty placeholder)

- [ ] Same as B11 / B12, but in a judge prompt.
  - **Expected**: backslashes round-trip; `{{}}` raises rather than dumping the full context (which on the judge side includes `inputs`, `outputs`, `trace`, `parameters` — a much bigger leak surface than chat/completion).

---

## D. Direct backend / API calls (regression)

Same surface, but exercised without the playground UI to isolate transport from rendering.

### D1. Chat / completion via the public API

- [ ] `curl -X POST` the deployed app endpoint with a JSON body containing native object values:
  ```json
  {
    "inputs": {"profile": {"name": "Ada", "tags": ["x","y"]}}
  }
  ```
- [ ] Trace shows the rendered prompt.
  - **Expected**: native JSON preserved, `{{profile.name}}` resolves correctly.

### D2. Evaluator workflow direct call

- [ ] `POST` directly to the evaluator workflow endpoint with `inputs`, `outputs`, optional `trace`.
- [ ] Verify rendered prompt and result envelope.
  - **Expected**: same shape as before.

### D3. SDK direct invocation

- [ ] From a script using the agenta SDK, invoke an LLM-as-a-judge handler. See "Risks for SDK direct usage" below — there is a behavior change that may affect bare-script callers.

### D4. Evaluation service offline batch

- [ ] Trigger a full offline evaluation run via the API (not the UI).
- [ ] Confirm it completes and judge variables resolved per the matrix in C1.

### D5. Evaluation service online

- [ ] Trigger a chain that produces a trace; the online evaluator should pick it up.
- [ ] Same checks as C2.

---

## E. Visual / UX touch-ups

These aren't shipping changes here, but they're worth eyeballing because the new error paths could surface differently in the UI.

- [ ] When the new `InvalidSecretsV0Error` fires (no provider settings for a model), the UI shows the model name in the error toast / run details. No raw stack trace in the user-visible layer.
- [ ] When the curly renderer raises `UnresolvedVariablesError`, the UI shows the missing variable list in a readable format. The judge's wrapping path keeps the legacy "Template variables not found or unresolved: …" message — confirm it's still parsed/displayed correctly.
- [ ] Evaluator model picker: custom-provider strings round-trip after save → reopen.

---

# Side note: does this PR change LLM-as-a-judge usage from the SDK?

Short answer: yes, for one corner case. Long answer:

## What changed in the judge runtime

Before:

- The judge resolved provider credentials by reading a fixed set of provider keys (a hard-coded list — OpenAI, Anthropic, etc.) and patched `litellm.openai_key = ...` at module level.
- The judge called the LLM with `temperature=0.01` always.

After:

- The judge calls `SecretsManager.ensure_secrets_in_workflow()` and `SecretsManager.get_provider_settings_from_workflow(model)` — the same path chat/completion uses. This unlocks custom and self-hosted models.
- If `get_provider_settings_from_workflow(model)` returns nothing for the selected model, the runtime raises `InvalidSecretsV0Error` (carries the model name) instead of silently sending the wrong/empty key.
- The LLM call is wrapped in `mockllm.user_aws_credentials_from(provider_settings)` (scrubs ECS / Lambda role env vars for the call's duration, then restores them) and goes through `mockllm.acompletion(..., **provider_settings)` rather than the legacy module-level patch.
- `temperature` is no longer sent.

## Risks for SDK direct usage

The judge handler is `auto_ai_critique_v0` in `sdk/agenta/sdk/engines/running/handlers.py`. Two patterns to think about:

### 1. Calling the judge via the evaluation service (canonical path)

No change. The evaluation service workers set up the workflow context (project, secrets, etc.) before invoking the handler. `ensure_secrets_in_workflow()` finds the context, `get_provider_settings_from_workflow(model)` returns the configured settings, and the call proceeds. This is what >99% of usage looks like.

**Risk: low.** Behavior parity with chat/completion is the goal of WP-B1, and chat/completion has been on this code path for a while.

### 2. Calling `auto_ai_critique_v0` directly from a Python script (rare but possible)

Pre-PR: a script could set `OPENAI_API_KEY` in the environment and call the judge handler directly. The legacy code patched `litellm.openai_key` from a workflow-context lookup but fell through to env-var pickup if litellm could find the key. So a bare script with env vars often "just worked".

Post-PR: the judge requires a workflow context with provider settings to be present. If you call the handler from a script that has never set up the workflow context (no `ensure_secrets_in_workflow` available, no project, no model-hub config), it raises `InvalidSecretsV0Error` even if `OPENAI_API_KEY` is in the environment.

**Risk: medium for the narrow case.** Symptoms:

- A user running `python -c "from agenta.sdk.engines.running.handlers import auto_ai_critique_v0; ..."` outside a runtime context will now hit the new error.
- Evaluation jobs run via the SDK's local evaluation harness (e.g., `agenta evaluate ...` if such a flow exists locally) need to thread the secrets manager through. Worth confirming the local harness already does this — it should, because chat/completion already required it.

**Mitigations / docs to add when WP-B2 lands:**

- The SDK's local evaluation example should explicitly show how to bootstrap the workflow context for offline / scripted use.
- An error message with a doc link ("Configure your model and key in Model Hub before running this judge from the SDK") would soften the failure mode.

### 3. Output behavior changes

- **`temperature=0.01` is gone.** Output may be marginally less deterministic for users who relied on that (although prompt design dominates determinism). For evaluator stability, this is on net a win — many newer providers (reasoning models, Anthropic with certain tool configurations) reject `temperature` outright, and the hard-coded value was a foot-gun.
- **Output shape unchanged.** The handler still returns the same `{score, success}` / `{success}` / dict shape. No downstream consumer needs to change.
- **Render context unchanged.** All variables (`inputs`, `outputs`, `prediction`, `ground_truth`, `correct_answer`, `reference`, `trace`, `parameters`) bind exactly as before. The pure rendering helper extraction is behavior-equivalent (309 unit tests pin this).

### 4. Secondary risks from the rendering review

- **Backslash fix.** Templates that previously relied on doubled backslashes in the rendered output (extremely unlikely, but possible — e.g., if a user noticed the doubling and pre-halved their input to compensate) will now render with the original backslash count. This is the correct behavior; flag in release notes.
- **Empty placeholder fix.** Templates accidentally containing `{{}}` will now error instead of silently rendering. This is the correct behavior; if anyone was depending on the leak, it was an accident and an error is better than silent leakage of context state.

## Bottom line

If your SDK usage of LLM-as-a-judge goes through:
- **The evaluation service** (offline batch / online streaming) → no changes for you. Custom models now work; standard models keep working.
- **The agenta runtime in production** (judge invoked via a workflow) → no changes. Same picture as chat/completion.
- **A bare script that imports the handler directly** → confirm you bootstrap the workflow context. Pre-PR this might have worked from env vars; post-PR it wants a configured project / model hub.

The PR's risk surface is mostly upside (custom models work, temperature foot-gun gone, two real bugs fixed). The script-direct case is the one regression vector and easy to fix at the call site if it shows up.
