# CV Screening with Agenta

A complete walkthrough for building a CV classifier with Agenta: a prompt
that evaluates a candidate's CV (as Markdown) against a job specification
and returns a structured assessment — per-area scores, matched and missing
requirements, and a final classification (`strong_match`, `potential_match`,
or `no_match`).

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
| `data/testset.csv` | 30 real Markdown CVs with hand-labeled expected classifications (committed, ready to upload) |
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
- **7 potential matches** — IT specialists and supervisors missing
  management scope, plus an engineering manager with weak IT depth
- **17 rejections** — interns, and candidates from unrelated fields (chef,
  teacher, attorney, finance analyst, ...), including one resume that is
  mislabeled in the source dataset (an "IT Coordinator" that is actually a
  paralegal CV — a nice robustness check for the classifier)

Each CSV row has:

| Column | Content |
| --- | --- |
| `cv` | The CV as Markdown — maps to the `{{cv}}` input of the prompt |
| `expected_classification` | Hand-assigned ground truth (`strong_match` / `potential_match` / `no_match`) |
| `source_category` | Original category label from the dataset |
| `source_id` | Resume ID in the source dataset |

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
the prompt: tighten the requirements, change the model, adjust the scoring
rubric. Then run an evaluation against the test set — since the output is
structured JSON and the test set has an `expected_classification` column,
you can use a JSON-field match evaluator on `classification`, or add an
LLM-as-a-judge for the reasoning quality.

### 4. Run the demo app

```bash
streamlit run app.py
```

Upload one of the PDFs from `data/sample_cvs/` (or any CV). The app:

1. converts the PDF to Markdown with [markitdown](https://github.com/microsoft/markitdown),
2. fetches the production prompt from the Agenta registry
   (`ag.ConfigManager.get_from_registry`) — so whatever you deploy from the
   playground is what the app uses, with no redeploy,
3. calls the LLM with the structured-output schema,
4. renders the scores, requirement checklists, and final classification.

The `classify_cv` call is instrumented with `@ag.instrument()`, so every
screening shows up as a trace in Agenta's observability view.

## Adapting it to your role

Everything role-specific lives in the prompt: edit the job spec directly in
the Agenta playground (or in `config.py` and re-run `create_app.py`). The
structured-output schema and the app don't need to change. To build a test
set for a different role, adjust the curated IDs and labels in
`prepare_testset.py` — the source dataset has 24 job categories to draw
from.
