"""Streamlit demo: upload a CV as PDF and screen it against the job spec.

The flow mirrors a production setup:

1. The PDF is converted to Markdown locally (markitdown).
2. The screening prompt is fetched from the Agenta registry — the same
   prompt you iterate on in the playground and evaluate against the
   test set.
3. The prompt is formatted with the CV and sent to the LLM with a JSON
   schema response format.
4. The structured result (per-area scores and final classification) is
   rendered as a small dashboard.

Run with:
    streamlit run app.py
"""

import io
import json

import agenta as ag
import streamlit as st
from agenta.sdk.types import PromptTemplate
from markitdown import MarkItDown
from openai import OpenAI

from config import APP_SLUG, PROMPT_CONFIG

CLASSIFICATION_STYLES = {
    "strong_match": ("Strong match", st.success),
    "potential_match": ("Potential match", st.warning),
    "no_match": ("No match", st.error),
}

SCORE_LABELS = {
    "experience": "Experience",
    "technical_skills": "Technical skills",
    "leadership": "Leadership",
    "education_certifications": "Education & certs",
}


@st.cache_resource
def init_agenta() -> None:
    ag.init()


@st.cache_data(ttl=60)
def fetch_prompt_config() -> tuple[dict, str]:
    """Fetch the prompt deployed to production, falling back to the local default."""
    try:
        config = ag.ConfigManager.get_from_registry(app_slug=APP_SLUG)
        return config, f"Agenta registry ('{APP_SLUG}', production)"
    except Exception:
        return PROMPT_CONFIG, "local default (run create_app.py to manage it in Agenta)"


@st.cache_data(show_spinner="Converting PDF to Markdown ...")
def pdf_to_markdown(file_bytes: bytes) -> str:
    result = MarkItDown().convert_stream(io.BytesIO(file_bytes), file_extension=".pdf")
    return result.text_content.strip()


@ag.instrument()
def classify_cv(cv_markdown: str, config: dict) -> dict:
    prompt = PromptTemplate(**config["prompt"]).format(cv=cv_markdown)
    response = OpenAI().chat.completions.create(**prompt.to_openai_kwargs())
    return json.loads(response.choices[0].message.content)


def render_result(result: dict) -> None:
    label, banner = CLASSIFICATION_STYLES[result["classification"]]
    banner(f"**{label}** — {result['reasoning']}")

    columns = st.columns(len(SCORE_LABELS))
    for column, (key, score_label) in zip(columns, SCORE_LABELS.items()):
        with column:
            st.metric(score_label, f"{result['scores'][key]}/5")
            st.progress(result["scores"][key] / 5)

    matched, missing, extras = st.columns(3)
    with matched:
        st.subheader("Requirements met")
        for item in result["matched_requirements"] or ["—"]:
            st.markdown(f"- ✅ {item}")
    with missing:
        st.subheader("Requirements missing")
        for item in result["missing_requirements"] or ["—"]:
            st.markdown(f"- ❌ {item}")
    with extras:
        st.subheader("Nice-to-haves")
        for item in result["nice_to_haves"] or ["—"]:
            st.markdown(f"- ⭐ {item}")


def main() -> None:
    st.set_page_config(page_title="CV Screening", page_icon="📄", layout="wide")
    st.title("📄 CV Screening")
    st.caption(
        "Upload a CV as PDF. It is converted to Markdown and screened against "
        "the job spec by the prompt managed in Agenta."
    )

    init_agenta()
    config, source = fetch_prompt_config()
    st.sidebar.markdown(f"**Prompt source:** {source}")
    st.sidebar.markdown(f"**Model:** {config['prompt']['llm_config']['model']}")

    uploaded = st.file_uploader("Candidate CV (PDF)", type=["pdf"])
    if uploaded is None:
        st.info("Upload a PDF to get started. Sample CVs are in `data/sample_cvs/`.")
        return

    cv_markdown = pdf_to_markdown(uploaded.getvalue())
    with st.expander("Extracted Markdown", expanded=False):
        st.markdown(cv_markdown)

    if st.button("Screen candidate", type="primary"):
        with st.spinner("Evaluating CV against the job spec ..."):
            result = classify_cv(cv_markdown, config)
        render_result(result)


if __name__ == "__main__":
    main()
