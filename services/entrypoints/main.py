from fastapi import FastAPI

import agenta as ag

from oss.src.managed import (
    builtin_auto_ai_critique_app,
    builtin_auto_contains_all_app,
    builtin_auto_contains_any_app,
    builtin_auto_contains_app,
    builtin_auto_contains_json_app,
    builtin_auto_custom_code_run_app,
    builtin_auto_ends_with_app,
    builtin_auto_exact_match_app,
    builtin_auto_json_diff_app,
    builtin_auto_levenshtein_distance_app,
    builtin_auto_regex_test_app,
    builtin_auto_semantic_similarity_app,
    builtin_auto_similarity_match_app,
    builtin_auto_starts_with_app,
    builtin_auto_webhook_test_app,
    builtin_field_match_test_app,
    builtin_json_multi_field_match_app,
    builtin_llm_app,
    builtin_match_app,
    custom_code_app,
    custom_hook_app,
)
from oss.src.chat import chat_app
from oss.src.completion import completion_app


ag.init()

# Create main app that will mount sub-applications
app = FastAPI()

# Mount both apps under their respective paths
#
app.mount(
    "/chat",
    chat_app,
)
app.mount(
    "/completion",
    completion_app,
)
#
app.mount(
    "/custom/code/v0",
    custom_code_app,
)
app.mount(
    "/custom/hook/v0",
    custom_hook_app,
)
app.mount(
    "/builtin/match/v0",
    builtin_match_app,
)
app.mount(
    "/builtin/llm/v0",
    builtin_llm_app,
)
app.mount(
    "/builtin/auto_exact_match/v0",
    builtin_auto_exact_match_app,
)
app.mount(
    "/builtin/auto_regex_test/v0",
    builtin_auto_regex_test_app,
)
app.mount(
    "/builtin/field_match_test/v0",
    builtin_field_match_test_app,
)
app.mount(
    "/builtin/json_multi_field_match/v0",
    builtin_json_multi_field_match_app,
)
app.mount(
    "/builtin/auto_webhook_test/v0",
    builtin_auto_webhook_test_app,
)
app.mount(
    "/builtin/auto_custom_code_run/v0",
    builtin_auto_custom_code_run_app,
)
app.mount(
    "/builtin/auto_ai_critique/v0",
    builtin_auto_ai_critique_app,
)
app.mount(
    "/builtin/auto_starts_with/v0",
    builtin_auto_starts_with_app,
)
app.mount(
    "/builtin/auto_ends_with/v0",
    builtin_auto_ends_with_app,
)
app.mount(
    "/builtin/auto_contains/v0",
    builtin_auto_contains_app,
)
app.mount(
    "/builtin/auto_contains_any/v0",
    builtin_auto_contains_any_app,
)
app.mount(
    "/builtin/auto_contains_all/v0",
    builtin_auto_contains_all_app,
)
app.mount(
    "/builtin/auto_contains_json/v0",
    builtin_auto_contains_json_app,
)
app.mount(
    "/builtin/auto_json_diff/v0",
    builtin_auto_json_diff_app,
)
app.mount(
    "/builtin/auto_levenshtein_distance/v0",
    builtin_auto_levenshtein_distance_app,
)
app.mount(
    "/builtin/auto_similarity_match/v0",
    builtin_auto_similarity_match_app,
)
app.mount(
    "/builtin/auto_semantic_similarity/v0",
    builtin_auto_semantic_similarity_app,
)


# Health check endpoint
@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    from uvicorn import run

    run(
        "entrypoints.main:app",
        host="0.0.0.0",
        port=8080,
        reload=True,
        reload_dirs=[".", "/sdk"],
    )
