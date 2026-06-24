import json
import os
import uuid

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import db

SIDECAR_URL = os.environ.get("SIDECAR_URL", "http://sidecar:8080")
S3_URL = os.environ.get("SEAWEEDFS_S3_URL", "http://seaweedfs:8333")
S3_KEY = os.environ.get("SEAWEEDFS_S3_ACCESS_KEY", "demo")
S3_SECRET = os.environ.get("SEAWEEDFS_S3_SECRET_KEY", "demosecret")
S3_BUCKET = os.environ.get("SEAWEEDFS_S3_BUCKET", "demo")

app = FastAPI(title="persistent-sessions demo")


@app.on_event("startup")
async def _startup():
    await db.init()


class InvokeBody(BaseModel):
    session_id: uuid.UUID | None = None
    prompt: str
    sandbox: str = "local"  # where it runs: local | modal | e2b | daytona
    harness: str = "claude"  # coding agent: claude | codex | opencode | pi
    provider: str = "anthropic"  # LLM API: anthropic | openai
    model: str | None = None  # model id (keyed by provider)
    reasoning: str = "none"  # thoughtLevel: none | low | medium | high


def _runner_for(sandbox: str) -> str:
    # runner is derived, not chosen: local container vs rivet cloud sandbox.
    return "local" if sandbox == "local" else "rivet"


@app.post("/invoke")
async def invoke(body: InvokeBody):
    # null id -> mint + create with requested dimensions;
    # provided -> resume; sandbox/harness/provider/model/reasoning are FIXED to creation.
    sandbox_id = None
    if body.session_id is None or (await db.get_session(str(body.session_id))) is None:
        sid = str(body.session_id) if body.session_id else str(uuid.uuid4())
        sandbox, harness = body.sandbox, body.harness
        provider, model, reasoning = body.provider, body.model, body.reasoning
        await db.create_session(
            sid,
            f"/work/{sid}",
            f"{S3_BUCKET}/{sid}/",
            sandbox,
            harness,
            runner=_runner_for(sandbox),
            provider=provider,
            model=model,
            reasoning=reasoning,
        )
    else:
        sid = str(body.session_id)
        row = await db.get_session(sid)
        sandbox, harness = row["sandbox"], row["harness"]
        provider, model, reasoning = row["provider"], row["model"], row["reasoning"]
        sandbox_id = row["sandbox_id"]

    stop_reason = None
    error = None

    # Stream NDJSON events from the sidecar and persist each as it arrives.
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST",
            f"{SIDECAR_URL}/run",
            json={
                "session_id": sid,
                "prompt": body.prompt,
                "sandbox": sandbox,
                "harness": harness,
                "provider": provider,
                "model": model,
                "reasoning": reasoning,
                "sandbox_id": sandbox_id,
            },
        ) as resp:
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line:
                    continue
                evt = json.loads(line)
                if (
                    "_sandbox_id" in evt
                ):  # remote provider reports its sandbox id for resume
                    await db.set_sandbox_id(sid, evt["_sandbox_id"])
                    continue
                if evt.get("_done"):
                    stop_reason = evt.get("stop_reason")
                    error = evt.get("error")
                    continue
                await db.append_event(
                    sid,
                    evt.get("event_index"),
                    evt.get("sender"),
                    evt.get("session_update"),
                    evt.get("payload") or {},
                )

    if error:
        raise HTTPException(status_code=500, detail=error)
    return {"session_id": sid, "stop_reason": stop_reason}


@app.get("/sessions")
async def sessions():
    return {"sessions": await db.list_sessions()}


@app.delete("/sessions/{sid}/sandbox")
async def kill_sandbox(sid: str):
    # Destroy the remote sandbox; the cwd stays durable in SeaweedFS, so the next
    # /invoke spins a fresh sandbox and remounts the same prefix.
    row = await db.get_session(sid)
    if row is None:
        raise HTTPException(404, "no such session")
    if not row["sandbox_id"]:
        return {"killed": None, "note": "no live sandbox for this session"}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{SIDECAR_URL}/kill",
                json={"sandbox": row["sandbox"], "sandbox_id": row["sandbox_id"]},
            )
            r.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(502, f"kill failed: {e}")
    await db.set_sandbox_id(sid, None)
    return {"killed": row["sandbox_id"]}


@app.delete("/sessions/{sid}")
async def delete_session(sid: str):
    if not await db.session_exists(sid):
        raise HTTPException(404, "no such session")
    # 1) unmount + remove the cwd in the sandbox (best-effort; sandbox may be down)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            await client.post(f"{SIDECAR_URL}/unmount", json={"session_id": sid})
    except httpx.HTTPError:
        pass
    # 2) delete the SeaweedFS prefix demo/<sid>/
    await _delete_s3_prefix(sid)
    # 3) delete the Postgres rows (transcripts + session)
    await db.delete_session(sid)
    return {"deleted": sid}


async def _delete_s3_prefix(sid: str):
    import aioboto3

    s = aioboto3.Session()
    async with s.client(
        "s3",
        endpoint_url=S3_URL,
        aws_access_key_id=S3_KEY,
        aws_secret_access_key=S3_SECRET,
        region_name="us-east-1",
    ) as s3:
        resp = await s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=f"{sid}/")
        keys = [{"Key": o["Key"]} for o in resp.get("Contents", [])]
        if keys:
            await s3.delete_objects(Bucket=S3_BUCKET, Delete={"Objects": keys})


@app.get("/sessions/{sid}/transcript")
async def transcript(sid: str):
    if not await db.session_exists(sid):
        raise HTTPException(404, "no such session")
    return {"session_id": sid, "events": await db.get_transcript(sid)}


@app.get("/sessions/{sid}/files")
async def files(sid: str, read: str | None = None):
    # Read the cwd straight from SeaweedFS (works whether or not the sandbox is up).
    import aioboto3

    s = aioboto3.Session()
    async with s.client(
        "s3",
        endpoint_url=S3_URL,
        aws_access_key_id=S3_KEY,
        aws_secret_access_key=S3_SECRET,
        region_name="us-east-1",
    ) as s3:
        if read is not None:
            try:
                obj = await s3.get_object(Bucket=S3_BUCKET, Key=f"{sid}/{read}")
                body = await obj["Body"].read()
                return {"path": read, "content": body.decode("utf-8", "replace")}
            except s3.exceptions.NoSuchKey:
                raise HTTPException(404, "no such file")
        resp = await s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=f"{sid}/")
        return {
            "source": "seaweedfs",
            "files": [
                {"path": o["Key"][len(sid) + 1 :], "size": o["Size"]}
                for o in resp.get("Contents", [])
                if o["Key"] != f"{sid}/"
            ],
        }


# Static playground UI (filesystem viewer + invoke form + session list).
from fastapi.staticfiles import StaticFiles  # noqa: E402

app.mount("/", StaticFiles(directory="static", html=True), name="static")
