"""Streamlit demo: upload a CV as PDF and screen it against the job spec.

This file is UI only. All the AI logic (prompt fetching, the LLM call,
tracing, and feedback) lives in `screening.py`, which any other frontend
could reuse. The flow mirrors a production setup:

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
import os

import streamlit as st
from dotenv import load_dotenv
from markitdown import MarkItDown

import screening

load_dotenv()

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
def init_screening() -> None:
    screening.init()


@st.cache_data(ttl=60)
def fetch_config() -> screening.ScreeningConfig:
    return screening.fetch_config()


@st.cache_data(show_spinner="Converting PDF to Markdown ...")
def pdf_to_markdown(file_bytes: bytes) -> str:
    result = MarkItDown().convert_stream(io.BytesIO(file_bytes), file_extension=".pdf")
    return result.text_content.strip()


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
        elif screening.send_feedback(
            invocation, thumbs_up=rating == 1, comment=comment
        ):
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

    init_screening()
    config = fetch_config()
    st.sidebar.markdown(f"**Prompt source:** {config.source}")
    st.sidebar.markdown(f"**Model:** {config.params['prompt']['llm_config']['model']}")

    uploaded = st.file_uploader("Candidate CV (PDF)", type=["pdf"])
    if uploaded is None:
        st.info("Upload a PDF to get started. Sample CVs are in `data/sample_cvs/`.")
        return

    cv_markdown = pdf_to_markdown(uploaded.getvalue())
    with st.expander("Extracted Markdown", expanded=False):
        st.markdown(cv_markdown)

    if st.button("Screen candidate", type="primary"):
        with st.spinner("Evaluating CV against the job spec ..."):
            result = screening.classify_cv({"cv": cv_markdown}, config)
        st.session_state["screening"] = {"cv": cv_markdown, "result": result}

    # Render from session state so the result (and its feedback form)
    # survives the reruns Streamlit triggers on every interaction.
    current = st.session_state.get("screening")
    if current and current["cv"] == cv_markdown:
        render_result(current["result"])
        render_feedback(current["result"])


if __name__ == "__main__":
    main()
