"""CV screening logic: prompt fetching, the LLM call, tracing, and feedback.

This module owns everything that talks to Agenta and the LLM. The Streamlit
app (`app.py`) is only a UI shell around it; a CLI or an API endpoint could
import this module unchanged.

Tracing design:

- `init()` sets up Agenta tracing and auto-instruments the OpenAI client
  (via OpenInference), so every screening trace contains a child LLM span
  with the exact messages, model, token counts, and cost.
- `classify_cv(inputs, config)` takes its inputs as a dict whose keys match
  the prompt's input variables (`{"cv": ...}`). The prompt configuration is
  excluded from the trace (`ignore_inputs`); instead the span is linked to
  the exact prompt revision through references (`ag.tracing.store_refs`).
  Together these let you open the span in the Agenta playground and land on
  the same prompt revision with the same inputs pre-filled.
"""

import json
import os
from dataclasses import dataclass, field

import agenta as ag
import requests
from agenta.sdk.managers.shared import SharedManager
from agenta.sdk.types import PromptTemplate
from openai import OpenAI
from openinference.instrumentation.openai import OpenAIInstrumentor

from config import APP_SLUG, PROMPT_CONFIG

FEEDBACK_EVALUATOR_SLUG = "user-feedback"


def init() -> None:
    """Initialize Agenta tracing and auto-instrument the OpenAI client.

    Call this once at startup. After this, every OpenAI call shows up as a
    child LLM span (messages, model, tokens, cost) under the active trace.
    """
    ag.init()
    OpenAIInstrumentor().instrument()


@dataclass
class ScreeningConfig:
    """The prompt configuration plus the references identifying its revision."""

    params: dict
    source: str
    refs: dict = field(default_factory=dict)


def fetch_config() -> ScreeningConfig:
    """Fetch the prompt deployed to production, falling back to the local default.

    Returns the prompt parameters together with the application / variant /
    environment references of the deployed revision, so each trace can be
    linked back to the exact prompt version it used.
    """
    try:
        configuration = SharedManager.fetch(
            app_slug=APP_SLUG,
            environment_slug="production",
        )
        if not configuration.params.get("prompt"):
            raise ValueError("empty configuration returned from registry")

        refs = {
            "application.id": configuration.app_id,
            "application.slug": configuration.app_slug,
            "variant.id": configuration.variant_id,
            "variant.slug": configuration.variant_slug,
            "variant.version": configuration.variant_version,
            "environment.slug": configuration.environment_slug,
        }
        refs = {key: value for key, value in refs.items() if value is not None}

        return ScreeningConfig(
            params=configuration.params,
            source=f"Agenta registry ('{APP_SLUG}', production)",
            refs=refs,
        )
    except Exception:
        return ScreeningConfig(
            params=PROMPT_CONFIG,
            source="local default (run create_app.py to manage it in Agenta)",
        )


@ag.instrument(ignore_inputs=["config"], ignore_outputs=["_invocation"])
def classify_cv(inputs: dict, config: ScreeningConfig) -> dict:
    """Screen a CV against the job spec and return the structured assessment.

    `inputs` mirrors the prompt's input variables: `{"cv": <markdown>}`.
    """
    prompt = PromptTemplate(**config.params["prompt"]).format(**inputs)
    response = OpenAI().chat.completions.create(**prompt.to_openai_kwargs())
    result = json.loads(response.choices[0].message.content)

    # Link this span to the prompt revision that produced it, so the trace
    # can be filtered by app/variant/environment and opened in the playground
    # on the right revision.
    ag.tracing.store_refs(config.refs)

    # Capture the trace/span ids while the span is still open, so user
    # feedback can be attached to this invocation as an annotation. The
    # field is excluded from the span outputs (`ignore_outputs` above).
    link = ag.tracing.build_invocation_link()
    if link is not None:
        result["_invocation"] = {"trace_id": link.trace_id, "span_id": link.span_id}
    return result


def send_feedback(invocation: dict, thumbs_up: bool, comment: str) -> bool:
    """Attach user feedback to a screening trace as an Agenta annotation."""
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
