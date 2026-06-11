# CV Screening with Agenta

A complete walkthrough for building a CV classifier with Agenta: a prompt
that evaluates a candidate's CV (as Markdown) against a job specification
and returns a structured assessment — a technical-skills match, an
experience match, and an overall hire/no-hire recommendation, each with a
short reason, plus the list of missing must-have requirements.

The split between Agenta and the application code follows the pattern we
recommend for production:

- **Inside Agenta**: the prompt (job requirements, nice-to-haves, scoring
  instructions), the model configuration, the structured-output JSON schema,
  and the test set of Markdown CVs. This is what you iterate on in the
  playground, evaluate, and deploy.
- **Outside Agenta**: everything around the prompt — a small Streamlit app
  that accepts a PDF upload, converts it to Markdown, fetches the deployed
  prompt from the Agenta registry, calls the LLM, and renders the result.

```
PDF upload ──> Markdown (markitdown) ──> prompt fetched from Agenta ──> LLM ──> structured scores
```

## What's in this folder

| File | Purpose |
| --- | --- |
| `config.py` | Job spec, prompt messages, structured-output JSON schema, app slugs |
| `create_app.py` | Creates the `cv-screening` app in Agenta and deploys the prompt to production |
| `prepare_testset.py` | Builds `data/testset.csv` from a public resume dataset (optionally uploads it to Agenta) |
| `data/testset.csv` | 30 real Markdown CVs with hand-labeled expected matches (committed, ready to upload) |
| `screening.py` | The AI logic: fetches the prompt, calls the LLM, traces, sends feedback |
| `app.py` | Streamlit demo UI: upload a PDF, screen the candidate |
| `make_sample_pdfs.py` | Renders three test set CVs as PDFs for the demo |
| `data/sample_cvs/` | Sample CV PDFs (one strong match, one potential match, one rejection) |

## The test set

The test set is built from the
[`opensporks/resumes`](https://huggingface.co/datasets/opensporks/resumes)
dataset on Hugging Face — a mirror of the Kaggle
[Resume Dataset](https://www.kaggle.com/datasets/snehaanbhawal/resume-dataset)
(~2,400 real, anonymized resumes from livecareer.com, 24 job categories).

`prepare_testset.py` takes a curated subset of 30 resumes, converts them from
HTML to clean Markdown, and labels each one by hand against the IT Manager
job spec in `config.py`:

- **6 strong matches** — seasoned IT managers, directors, and a VP of IT
- **7 partial matches** — IT specialists and supervisors missing
  management scope, plus an engineering manager with weak IT depth
- **17 rejections** — interns, and candidates from unrelated fields (chef,
  teacher, attorney, finance analyst, ...), including one resume that is
  mislabeled in the source dataset (an "IT Coordinator" that is actually a
  paralegal CV — a nice robustness check for the classifier)

Each CSV row has:

| Column | Content |
| --- | --- |
| `cv` | The CV as Markdown — maps to the `{{cv}}` input of the prompt |
| `expected_tech_match` | Hand-assigned ground truth for `tech_match` (`true` / `false`) |
| `expected_experience_match` | Hand-assigned ground truth for `experience_match` (`true` / `false`) |
| `expected_overall_match` | Hand-assigned ground truth for `overall_match` (`true` / `false`) |

An empty expected cell means "no ground truth for this dimension"; the code
evaluator below skips it. That is how you add a test case that only pins
down the overall decision (for example, a CV that fails a new requirement)
without having to label the other dimensions.

The CVs are Markdown rather than PDFs on purpose: PDF parsing happens
outside Agenta (in the app), so the test set captures exactly what the
prompt receives. This keeps evaluations reproducible and independent of the
PDF-extraction step.

## Walkthrough

### 0. Setup

```bash
pip install -r requirements.txt
cp .env.example .env   # then fill in your keys
```

### 1. Create the prompt in Agenta

```bash
python create_app.py
```

This creates a completion app called `cv-screening`, commits the screening
prompt (with the job spec and the JSON schema for structured output), and
deploys it to the production environment. Open the app in Agenta to see it
in the playground.

### 2. Upload the test set

The committed `data/testset.csv` can be uploaded directly in the Agenta UI
(Test sets → Create → Upload CSV), or via the SDK:

```bash
python prepare_testset.py --upload
```

(Without `--upload` the script just rebuilds the CSV from the source
dataset.)

### 3. Iterate and evaluate in Agenta

In the playground, load test cases from the test set and experiment with
the prompt: tighten the requirements, change the model, adjust the
instructions. To score runs against the hand-labeled
`expected_*` columns, create a custom code evaluator (Evaluators →
Create → Code) with:

```python
import json
from typing import Dict, Any

FIELDS = ("tech_match", "experience_match", "overall_match")


def evaluate(
    inputs: Dict[str, Any],
    outputs: Any,
    trace: Dict[str, Any],
) -> float:
    result = json.loads(outputs) if isinstance(outputs, str) else outputs

    checked = []
    for field in FIELDS:
        expected = str(inputs.get(f"expected_{field}") or "").strip().lower()
        if expected not in ("true", "false"):
            continue  # empty cell: no ground truth for this dimension
        checked.append(str(result.get(field)).lower() == expected)

    return sum(checked) / len(checked) if checked else 1.0
```

It compares each of the three match booleans to its `expected_*` column
and returns the fraction that agree. Empty expected cells are skipped, so
a test case can pin down only one dimension. Then run an evaluation with
the test set and this evaluator.

### 4. Run the demo app

```bash
streamlit run app.py
```

Upload one of the PDFs from `data/sample_cvs/` (or any CV). `app.py` is
UI only; the AI logic lives in `screening.py`. The flow:

1. the app converts the PDF to Markdown with [markitdown](https://github.com/microsoft/markitdown),
2. `screening.py` fetches the production prompt from the Agenta registry —
   so whatever you deploy from the playground is what the app uses, with no
   redeploy,
3. calls the LLM with the structured-output schema,
4. the app renders the three match verdicts with their reasons and the
   missing requirements.

Every screening shows up as a trace in Agenta's observability view, built
so you can act on it from the UI:

- `classify_cv` is instrumented with `@ag.instrument()`, and the OpenAI
  client is auto-instrumented with
  [OpenInference](https://github.com/Arize-ai/openinference), so each trace
  has a child LLM span with the exact messages, token counts, and cost.
- The span's inputs are the prompt's input variables (`{"cv": ...}`), and
  the prompt configuration is kept out of the trace (`ignore_inputs`).
- The span is linked to the exact prompt revision it used
  (`ag.tracing.store_refs`), so you can filter traces by app or environment
  and open the span in the playground on the same prompt revision, inputs
  pre-filled.

### 5. Collect user feedback on screenings

After each screening the app shows a feedback form: 👍/👎 plus an optional
comment. Submitting it attaches the feedback to that screening's trace as an
[annotation](https://docs.agenta.ai/observability/trace-with-python-sdk/annotate-traces)
under the `user-feedback` evaluator slug:

1. `classify_cv` captures the trace and span IDs while its span is open
   (`ag.tracing.build_invocation_link()`),
2. on submit, the app POSTs an annotation to `/api/simple/traces/` with
   `{"score": 1 | 0, "comment": ...}` linked to that invocation.

The feedback appears on the trace in Agenta's observability view, so you
can filter for badly rated screenings, inspect the CVs that caused them,
and turn them into new test cases. To see aggregated stats for the
`user-feedback` evaluator in the UI, create a matching human evaluator
(Evaluators → Human evaluators) with the same slug.

### 6. Close the loop: from feedback to a deployed fix

The pieces above compose into the core Agenta workflow. Say the role
requires fluent German, but the prompt doesn't mention it:

1. **Recruiter** screens a CV in the app, sees "Advance to interview" for
   a candidate with no German, and submits a 👎 with the comment
   *"candidate doesn't speak German"*.
2. **AI engineer** filters traces by the `user-feedback` annotation, opens
   the badly rated trace, and opens its span in the playground — landing
   on the exact prompt revision with the CV pre-filled.
3. In the playground, they add *"Fluent German (the company's working
   language)"* to the must-have requirements and rerun: `overall_match`
   flips to `false` and German shows up in `missing_requirements`, while
   `tech_match` and `experience_match` stay `true`.
4. They add the CV to the test set as a new test case with
   `expected_overall_match = false` and the other two expected columns
   left **empty** — the code evaluator only checks the overall decision
   for this case.
5. They run an evaluation comparing the deployed revision against the new
   one. The old prompt fails the new test case; the new prompt passes it
   without regressing the other 30.
6. They deploy the new revision to production. The Streamlit app picks it
   up on the next screening — no code change, no redeploy.

## Adapting it to your role

Everything role-specific lives in the prompt: edit the job spec directly in
the Agenta playground (or in `config.py` and re-run `create_app.py`). The
structured-output schema and the app don't need to change. To build a test
set for a different role, adjust the curated IDs and labels in
`prepare_testset.py` — the source dataset has 24 job categories to draw
from.
