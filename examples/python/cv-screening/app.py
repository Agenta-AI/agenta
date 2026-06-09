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
5. The user can rate the screening (thumbs up/down plus an optional
   comment); the feedback is attached to the trace in Agenta as an
   annotation.

Run with:
    streamlit run app.py
"""

import io
import json
import os

import agenta as ag
import requests
import streamlit as st
from agenta.sdk.types import PromptTemplate
from dotenv import load_dotenv
from markitdown import MarkItDown
from openai import OpenAI

from config import APP_SLUG, PROMPT_CONFIG

load_dotenv()

FEEDBACK_EVALUATOR_SLUG = "user-feedback"

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
    result = json.loads(response.choices[0].message.content)
    # Capture the trace/span ids while the span is still open, so user
    # feedback can be linked back to this invocation as an annotation.
    link = ag.tracing.build_invocation_link()
    if link is not None:
        result["_invocation"] = {"trace_id": link.trace_id, "span_id": link.span_id}
    return result


def send_feedback(invocation: dict, thumbs_up: bool, comment: str) -> bool:
    """Attach user feedback to the screening trace as an Agenta annotation."""
    outputs: dict = {"score": 1 if thumbs_up else 0}
    if comment.strip():
        outputs["comment"] = comment.strip()

    host = os.environ.get("AGENTA_HOST", "https://cloud.agenta.ai").rstrip("/")
    response = requests.post(
        f"{host}/api/simple/traces/",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"ApiKey {os.environ['AGENTA_API_KEY']}",
        },
        json={
            "trace": {
                "data": {"outputs": outputs},
                "references": {"evaluator": {"slug": FEEDBACK_EVALUATOR_SLUG}},
                "links": {"invocation": invocation},
            }
        },
        timeout=30,
    )
    return response.status_code in (200, 202)


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


def render_feedback(result: dict) -> None:
    invocation = result.get("_invocation")
    if invocation is None or not os.environ.get("AGENTA_API_KEY"):
        st.caption(
            "Feedback is disabled: set AGENTA_API_KEY so screenings are "
            "traced and can be annotated."
        )
        return

    st.divider()
    if st.session_state.get("feedback_sent") == invocation:
        st.success("Thanks! Your feedback was attached to the trace in Agenta.")
        return

    with st.form("feedback"):
        st.markdown("**Was this screening accurate?**")
        rating = st.feedback("thumbs")
        comment = st.text_input("Comment (optional)")
        submitted = st.form_submit_button("Send feedback")

    if submitted:
        if rating is None:
            st.warning("Pick 👍 or 👎 first.")
        elif send_feedback(invocation, thumbs_up=rating == 1, comment=comment):
            st.session_state["feedback_sent"] = invocation
            st.rerun()
        else:
            st.error("Could not send feedback to Agenta. Check the logs.")


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
        st.session_state["screening"] = {"cv": cv_markdown, "result": result}

    # Render from session state so the result (and its feedback form)
    # survives the reruns Streamlit triggers on every interaction.
    screening = st.session_state.get("screening")
    if screening and screening["cv"] == cv_markdown:
        render_result(screening["result"])
        render_feedback(screening["result"])


if __name__ == "__main__":
    main()
