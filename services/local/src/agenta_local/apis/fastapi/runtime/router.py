"""Runtime routes: runner health proxy and graceful shutdown."""

from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/runtime", tags=["runtime"])


@router.get("")
async def runtime_status(request: Request) -> dict:
    import httpx

    state = request.app.state
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{state.settings.runner_url}/health")
            runner = response.json() if response.status_code == 200 else {"ok": False}
    except httpx.HTTPError:
        runner = {"ok": False, "error": "runner unreachable"}
    return {
        "runner": runner,
        "version": state.version,
    }


@router.post("/shutdown", status_code=202)
async def shutdown(request: Request) -> dict:
    should_exit = getattr(request.app.state, "request_shutdown", None)
    if should_exit is not None:
        should_exit()
    return {"stopping": True}
