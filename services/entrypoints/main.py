from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

import agenta as ag
from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.decorators.routing import (
    create_app,
    handle_invoke_success,
    handle_invoke_failure,
    handle_inspect_success,
    handle_inspect_failure,
)
from agenta.sdk.decorators.running import invoke_workflow, inspect_workflow
from agenta.sdk.models.workflows import WorkflowInvokeRequest, WorkflowInspectRequest
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

log = get_module_logger(__name__)

# ---------------------------------------------------------------------------
# /services — dispatch endpoints (invoke/inspect by URI)
# ---------------------------------------------------------------------------

services_app = create_app()


@services_app.post("/invoke")
async def services_invoke(req: Request, request: WorkflowInvokeRequest):
    credentials = req.state.auth.get("credentials")
    try:
        response = await invoke_workflow(request=request, credentials=credentials)
        return await handle_invoke_success(req, response)
    except Exception as exception:
        return await handle_invoke_failure(exception)


@services_app.post("/inspect")
async def services_inspect(req: Request, request: WorkflowInspectRequest):
    credentials = req.state.auth.get("credentials")
    try:
        result = await inspect_workflow(request=request, credentials=credentials)
        return await handle_inspect_success(result)
    except Exception as exception:
        return await handle_inspect_failure(exception)


# ---------------------------------------------------------------------------
# Main app — mounts all sub-apps
# ---------------------------------------------------------------------------

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://0.0.0.0:3000",
        "http://0.0.0.0:3001",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health check endpoint — registered before mounts so the catch-all "/" mount
# does not intercept it before auth middleware runs.
@app.get("/health")
async def health():
    return {"status": "ok"}


app.mount("/chat", chat_app)
app.mount("/builtin/chat/v0", chat_app)
app.mount("/completion", completion_app)
app.mount("/builtin/completion/v0", completion_app)
#
app.mount("/custom/code/v0", custom_code_app)
app.mount("/custom/hook/v0", custom_hook_app)
app.mount("/builtin/match/v0", builtin_match_app)
app.mount("/builtin/llm/v0", builtin_llm_app)
app.mount("/builtin/auto_exact_match/v0", builtin_auto_exact_match_app)
app.mount("/builtin/auto_regex_test/v0", builtin_auto_regex_test_app)
app.mount("/builtin/field_match_test/v0", builtin_field_match_test_app)
app.mount("/builtin/json_multi_field_match/v0", builtin_json_multi_field_match_app)
app.mount("/builtin/auto_webhook_test/v0", builtin_auto_webhook_test_app)
app.mount("/builtin/auto_custom_code_run/v0", builtin_auto_custom_code_run_app)
app.mount("/builtin/auto_ai_critique/v0", builtin_auto_ai_critique_app)
app.mount("/builtin/auto_starts_with/v0", builtin_auto_starts_with_app)
app.mount("/builtin/auto_ends_with/v0", builtin_auto_ends_with_app)
app.mount("/builtin/auto_contains/v0", builtin_auto_contains_app)
app.mount("/builtin/auto_contains_any/v0", builtin_auto_contains_any_app)
app.mount("/builtin/auto_contains_all/v0", builtin_auto_contains_all_app)
app.mount("/builtin/auto_contains_json/v0", builtin_auto_contains_json_app)
app.mount("/builtin/auto_json_diff/v0", builtin_auto_json_diff_app)
app.mount(
    "/builtin/auto_levenshtein_distance/v0", builtin_auto_levenshtein_distance_app
)
app.mount("/builtin/auto_similarity_match/v0", builtin_auto_similarity_match_app)
app.mount("/builtin/auto_semantic_similarity/v0", builtin_auto_semantic_similarity_app)
#
# Mount dispatch LAST so "/" only catches /invoke and /inspect after specific mounts
app.mount("/", services_app)


@app.on_event("startup")
async def print_routes():
    def _walk(routes, prefix=""):
        for route in routes:
            methods = getattr(route, "methods", None)
            path = prefix + route.path
            if methods:
                log.info("  %-8s %s", ",".join(sorted(methods)), path)
            else:
                log.info("  %-8s %s", "MOUNT", path or "/")
                # sub_app = getattr(route, "app", None)
                # sub_routes = getattr(sub_app, "routes", None)
                # if sub_routes:
                #     _walk(sub_routes, prefix=path)

    log.info("Registered routes:")
    _walk(app.routes)


if __name__ == "__main__":
    from uvicorn import run

    run(
        "entrypoints.main:app",
        host="0.0.0.0",
        port=8080,
        reload=True,
        reload_dirs=[".", "/sdk"],
    )
