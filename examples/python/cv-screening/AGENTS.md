# CV screening demo: setup and gotchas

This file is for whoever (human or agent) sets the demo up on a fresh Agenta
instance. The user-facing walkthrough lives in `Readme.md`. This file covers the
mechanics and the SDK/platform traps that cost time the first few times.

## What the demo is

A recruiter screens CVs in a Streamlit app (`app.py`). Each screening is one
Agenta trace, linked to the exact prompt revision that produced it. The prompt
(`config.py`) judges three booleans with reasons: `tech_match`,
`experience_match`, `overall_match`.

The story: the company's working language is German. Every CV in the test set
has a German Languages section, but the prompt's job spec omits the language
requirement. The demo candidate (`candidate_it_manager.pdf`,
`DEMO_RESUME_ID` in `prepare_testset.py`, deliberately NOT in the test set)
is a strong IT manager without German. The walkthrough: recruiter flags the
wrong "advance" verdict, the AI engineer adds
`- Fluent German (the company's working language)` at the top of the
must-haves in the playground, adds the CV as a test case with only
`expected_overall_match=false`, and the before/after evaluation shows the fix
with zero regressions.

## Files

- `config.py` — app/variant slugs, the job spec, the prompt, the output JSON schema.
- `screening.py` — `init()`, `fetch_config()`, `classify_cv()`, `send_feedback()`. No UI.
- `app.py` — the Streamlit recruiter UI.
- `prepare_testset.py` — builds `data/testset.csv` (27 curated CVs with ground truth,
  all German speakers) and uploads it. Also defines `DEMO_RESUME_ID`.
- `make_sample_pdfs.py` — renders the four demo PDFs into `data/sample_cvs/`.
- `setup_app.py` — creates the app + prompt + production deploy. **Use this**, not `create_app.py` alone (see gotchas).
- `create_app.py` — the SDK-managers-only version. Kept to show the SDK gaps. It leaves the app broken on its own.
- `generate_traces.py` — screens N CVs to seed traces (no feedback).

## Setup, start to finish

Run everything from this folder, with the example venv.

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt

# .env (mode 600, gitignored):
#   OPENAI_API_KEY=sk-...
#   AGENTA_API_KEY=<scoped project key>
#   AGENTA_HOST=https://<host>        # e.g. http://144.76.237.122:8280, no trailing slash

.venv/bin/python prepare_testset.py --upload   # testset "CV Screening - IT Manager", 27 rows
.venv/bin/python make_sample_pdfs.py           # the four demo PDFs in data/sample_cvs/
.venv/bin/python setup_app.py                  # app + prompt(uri) + deploy to production
.venv/bin/python generate_traces.py --count 27 # seed traces without feedback
.venv/bin/streamlit run app.py                 # recruiter UI on :8501
```

Then two steps in the UI (no SDK surface for them):

1. **Code evaluator.** Create a custom-code evaluator and paste the snippet from
   `Readme.md`. It returns one score per dimension plus an aggregate. Verify it
   with a real evaluation run, not the test panel (see gotcha H).
2. **Feedback evaluator.** Nothing to do. The first `send_feedback()` call
   auto-creates a human evaluator with slug `user-feedback`.

Verify the setup:

```bash
# fetch resolves to the default variant, has a prompt
.venv/bin/python -c "import agenta as ag; from agenta.sdk.managers.shared import SharedManager
from dotenv import load_dotenv; load_dotenv(); ag.init()
c=SharedManager.fetch(app_slug='cv-screening', environment_slug='production')
print(c.variant_slug, c.variant_version, bool(c.params.get('prompt')))"
```

Open the app in the playground and run it once. If it returns a 404 HTML body
instead of JSON, the revision is missing its completion URI (gotcha A).

## Gotchas (the things that cost time)

These are why `setup_app.py` exists. It talks to the HTTP API directly to avoid
the SDK-manager paths that break a completion app. Background is in
`../../../docs/reviews/sdk-feedback-cv-screening-demo.md`.

**A. Completion apps need `data.uri` or the playground 404s.** A revision must
carry `data.uri = "agenta:builtin:completion:v0"`. The SDK managers
(`VariantManager.create` / `.commit`) leave it null, and `.commit` drops it even
from a variant that already had it. `setup_app.py` sets it on every commit.

**B. Both easy create paths name the variant badly.** `VariantManager.create`
leaves an auto-named variant holding the prompt plus an empty `default`.
`POST /simple/applications/` creates a single variant but names it with a hex
slug (for example `59830ad77428`), not `default` — the ugly name then shows in
the playground on camera. `setup_app.py` instead creates the artifact
(`POST /applications/`) and a variant named `default`
(`POST /applications/variants/`) explicitly, then archives any other variant
(and its tip revision) so the app shows only `default`.

**C. Never trust "current variant" auto-resolution.** `POST /simple/applications`
and its query resolve to the variant with the newest revision, which can be a
stale or even archived one. I deployed an orphan variant twice this way before
pinning it. Always commit and deploy by explicit variant id.

**C2. The first commit to a brand-new variant is dropped.** A variant created
with `POST /applications/variants/` starts with an empty `v0` placeholder, and
the first `revisions/commit` lands on it and loses the `data` (the revision
comes back as `v0` with no uri). A second commit takes (`v1`, uri set).
`setup_app.py` re-commits when the returned revision has no uri.

**D. The legacy deploy writes a broken environment revision.**
`DeploymentManager.deploy` produces an env revision with no per-app reference
map, so `SharedManager.fetch(environment_slug=...)` then raises "Environment
revision does not contain application references for the requested key". Deploy
with `POST /applications/revisions/deploy` and an `application_variant_ref`
instead.

**E. `SharedManager.fetch` does not surface `data.uri`.** It shows `uri: None`
in `params` even when the revision has the uri set. Do not use it to check the
uri. Use `POST /applications/revisions/retrieve` and read
`application_revision.data.uri`.

**F. An archived app keeps its slug reserved, and archiving a variant leaves its
revisions in the UI.** Recreating with the same slug returns 409 even after you
archive the app (there is no hard delete, only soft archive). To reset a messy
app, fix it in place: commit to `default`, then archive the orphan variant
(`POST /applications/variants/{id}/archive`) **and** its tip revision
(`POST /applications/revisions/{id}/archive`). Archiving only the variant hides
it from the variant list but its latest revision still shows in the app's
revision history with an ugly id-based name.

**G. OpenInference child LLM spans may not persist.** On the current dev build,
the `classify_cv` root span lands with its references, but the child
`ChatCompletion` span does not, even though it is created and exported in-process
(confirm with a `ConsoleSpanExporter` on the global provider). The likely cause
is a per-span builder error swallowed in
`api/oss/src/apis/fastapi/otlp/extractors/span_processor.py`. The root span plus
references is enough to open the trace in the playground. If you need the LLM
span, check the API logs for "Builder ... failed to process span_id". (EU cloud
did persist it, so this is build-specific.)

**H. The evaluator test panel does not pass testcase columns.** The panel sends
only the app inputs (`{"cv": ...}`), not the testset's `expected_*` columns, so a
ground-truth evaluator looks broken there. It works in a real evaluation run,
which passes the full row. Tracked as AGE-3825.

**I. No SDK surface for feedback annotations.** `send_feedback()` posts raw to
`POST /api/simple/traces/` with an evaluator slug and an invocation link. The
first call auto-creates the `user-feedback` evaluator.

## Resetting between demos

- Remove user feedback (the walkthrough starts with none): query
  `POST /api/preview/annotations/query`, then `DELETE /api/annotations/{trace_id}`
  for each `user-feedback` annotation (use the annotation's own trace id).
- Re-seed traces: `generate_traces.py` again. It is additive, not idempotent.
- Re-deploy the prompt after editing `config.py`: `setup_app.py` again. It is
  idempotent and always lands on `default`.

## Notes

- A scoped API key may point at a project that already has data. Filter traces by
  the `cv-screening` application; do not assume the project is empty.
- Costs real OpenAI tokens: `generate_traces.py` and every screening call hit
  `gpt-4o-mini`.
- **The demo beats are verified, not assumed.** Borderline CVs are model-unstable:
  gpt-4o-mini (and gpt-4o) judge ambiguous "partial match" resumes differently run
  to run, and a German requirement buried at the bottom of the must-have list only
  flipped the demo case ~2/3 of the time. The current set is tuned so the story is
  deterministic: labels follow the model's *stable* consensus, two bistable resumes
  were dropped (66832845, 25959103), and the walkthrough inserts the German line at
  the TOP of the must-haves (flips 5/5). If you change the model, temperature, or
  prompt wording, re-run a before/after evaluation over the full test set a couple
  of times before demoing.
