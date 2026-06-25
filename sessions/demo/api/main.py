import asyncio
import json
import os
import uuid

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import db
import locks

SIDECAR_URL = os.environ.get("SIDECAR_URL", "http://sidecar:8080")
S3_URL = os.environ.get("SEAWEEDFS_S3_URL", "http://seaweedfs:8333")
S3_KEY = os.environ.get("SEAWEEDFS_S3_ACCESS_KEY", "demo")
S3_SECRET = os.environ.get("SEAWEEDFS_S3_SECRET_KEY", "demosecret")
S3_BUCKET = os.environ.get("SEAWEEDFS_S3_BUCKET", "demo")

app = FastAPI(title="persistent-sessions demo")


@app.on_event("startup")
async def _startup():
    await db.init()


class Message(BaseModel):
    role: str = "user"
    content: str


class Inputs(BaseModel):
    messages: list[Message] = []


class Parameters(BaseModel):
    # session dimensions — fixed at creation, ignored on resume (read back from the DB).
    sandbox: str = "local"  # where it runs: local | modal | e2b | daytona
    harness: str = "claude"  # coding agent: claude | codex | opencode | pi
    provider: str = "anthropic"  # LLM API: anthropic | openai
    model: str | None = None  # model id (keyed by provider)
    reasoning: str = "none"  # thoughtLevel: none | low | medium | high


class RequestData(BaseModel):
    inputs: Inputs = Inputs()
    parameters: Parameters = Parameters()


class InvokeBody(BaseModel):
    # Control-plane envelope. `data` carries the work (a prompt + its parameters); `force`
    # is the cross-cutting "ENFORCE over another tab" knob. The DATA/FORCE matrix is the whole
    # protocol:
    #   data + msg, force=F  -> SEND           (409 if a run is alive)
    #   data + msg, force=T  -> STEER          (enforce: cancel the holder, run the new prompt)
    #   data=None,  force=F  -> CANCEL         (cancel the alive holder, run nothing)
    #   data=None,  force=T  -> ATTACH         (enforce: steal `attached`, watch a live run)
    #   (client closes conn) -> DETACH         (drop `attached`, run keeps going)
    # The force=T row is the ENFORCEMENT pair (steer, attach). A caller that doesn't support force
    # still gets send / cancel / detach — the meaningful, non-contentious actions. We'd rather lose
    # attach than cancel, so cancel is the force=F control and attach the force=T one.
    # data=None means "no work, control only" — distinct from data with EMPTY inputs, which is
    # a real (different) payload and must NOT be hijacked as a control signal.
    session_id: uuid.UUID | None = None
    data: RequestData | None = None
    force: bool = False


def _runner_for(sandbox: str) -> str:
    # runner is derived, not chosen: local container vs rivet cloud sandbox.
    return "local" if sandbox == "local" else "rivet"


def _response(
    sid: str,
    *,
    status: str,
    text: str | None = None,
    stop_reason: str | None = None,
    events: list | None = None,
    extra: dict | None = None,
) -> dict:
    """The Response envelope — mirror of the Request. The final output is the LAST element of
    data.outputs.messages; data.outputs.events is the batch event list (empty for control calls).
    `status` is the control/run disposition (done | detached | cancelled | attached | ended | …)."""
    messages = []
    if text is not None or stop_reason is not None:
        messages.append(
            {"role": "assistant", "content": text or "", "stop_reason": stop_reason}
        )
    out = {
        "session_id": sid,
        "status": status,
        "data": {"outputs": {"messages": messages, "events": events or []}},
    }
    if extra:
        out.update(extra)
    return out


def _prompt_of(body: InvokeBody) -> str | None:
    # The prompt is data.inputs.messages[0].content. `data is None` is the control-plane signal
    # (no work, intent only); EMPTY inputs is a real-but-different payload, NOT a control signal.
    if body.data is None:
        return None
    msgs = body.data.inputs.messages
    return msgs[0].content if msgs else None


async def _await_displaced(sid: str, token: str, flag: asyncio.Event) -> None:
    """Set `flag` the moment another watcher steals `attached` from `token` (Redis pub/sub)."""
    try:
        await locks.wait_displaced(sid, token)
        flag.set()
    except asyncio.CancelledError:
        raise
    except Exception:
        pass  # backstop tick still catches the steal


async def _watch_attached(sid: str, request: Request, source, token: str | None = None):
    """Hold `attached` for this browser and drive `source` (an async iterator of events) until it
    ends OR the browser disconnects. On disconnect we drop `attached` and stop — the run and its
    persistence are sidecar-side and keep going (detach must never cancel). Returns the final
    {stop_reason, error, text, events} if the source ran to completion, or None if we detached
    first. `text` = the last agent_message's text (the final output); `events` = the view events.

    Pass `token` to ADOPT an already-acquired attach lock (the steer path grabs `attached` up
    front to displace the prior watcher before the slow force-cancel); otherwise acquire here."""
    if token is None:
        token = str(uuid.uuid4())
        await locks.acquire_attached(sid, token)
    result = None
    events: list = []
    text = ""
    # A steal of `attached` PUBLISHES a displacement kick; this background task flips the event the
    # instant it arrives, so a displaced watcher closes with NO tick lag. The per-tick token probe
    # below stays as a backstop for the small window before this subscription is live.
    displaced = asyncio.Event()
    displaced_task = asyncio.create_task(_await_displaced(sid, token, displaced))
    # ONE persistent pull of the next event; we await it WITHOUT cancelling on timeout (cancelling
    # a half-read httpx stream corrupts it and ends the watch early). On timeout we just loop back
    # to re-check disconnect/displaced, leaving the same pending pull in flight for next time.
    ait = source.__aiter__()
    evt_task = asyncio.ensure_future(ait.__anext__())
    displaced_wait = asyncio.ensure_future(displaced.wait())
    print(f"[watch {sid[:8]}] START tok={token[:8]}", flush=True)
    try:
        last_refresh = 0.0
        # Short timeout so we still wake to check disconnect even when the run produces events
        # SLOWLY (e.g. codex appending one line per tool call). The displacement kick is handled
        # out-of-band by `displaced`, not by this timeout.
        while True:
            now = asyncio.get_event_loop().time()
            # check ownership (cheap GET) as a backstop for a missed kick. Only re-arm the TTL on
            # the slower refresh cadence.
            do_refresh = now - last_refresh >= locks.ATTACHED_REFRESH_S
            if not await locks.refresh_attached(sid, token, ttl=do_refresh):
                print(
                    f"[watch {sid[:8]}] BREAK lost-token (displaced via TTL probe)",
                    flush=True,
                )
                break
            if do_refresh:
                last_refresh = now
            if await request.is_disconnected():
                print(f"[watch {sid[:8]}] BREAK client-disconnected", flush=True)
                break  # browser left -> detach (run + persistence continue server-side)
            # race the (persistent) next-event pull against the displacement kick.
            done_set, _ = await asyncio.wait(
                {evt_task, displaced_wait},
                timeout=1.0,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if displaced_wait in done_set:
                print(f"[watch {sid[:8]}] BREAK displaced-kick", flush=True)
                break  # someone stole `attached` -> tear down at once
            if evt_task not in done_set:
                continue  # timeout, no event yet -> keep the SAME pull in flight, re-check above
            try:
                evt = evt_task.result()
            except StopAsyncIteration:
                print(
                    f"[watch {sid[:8]}] BREAK stream-ended (StopAsyncIteration)",
                    flush=True,
                )
                break
            evt_task = asyncio.ensure_future(ait.__anext__())  # arm the next pull
            if evt.get("_done"):
                result = {
                    "stop_reason": evt.get("stop_reason"),
                    "error": evt.get("error"),
                }
                continue
            if not evt or evt.get("_sandbox_id") is not None or "_sandbox_id" in evt:
                continue
            events.append(evt)
            if evt.get("session_update") == "agent_message":
                t = (
                    evt.get("payload", {})
                    .get("params", {})
                    .get("update", {})
                    .get("content", {})
                    .get("text", "")
                )
                if t:
                    text = t
    finally:
        print(
            f"[watch {sid[:8]}] END tok={token[:8]} displaced={displaced.is_set()} "
            f"result={result is not None} nevents={len(events)}",
            flush=True,
        )
        evt_task.cancel()
        displaced_wait.cancel()
        displaced_task.cancel()
        await locks.release_attached(sid, token)
    if result is not None:
        result["text"], result["events"] = text, events
    return result


async def _attach_poll(sid: str):
    """ATTACH source: poll the durable transcript while the run stays alive (no sidecar call).
    Yields a synthetic _done once `alive` clears, so _watch_attached unwinds like a real run."""
    while True:
        await asyncio.sleep(locks.ATTACHED_REFRESH_S)
        st = (await locks.status_many([sid])).get(sid, {})
        if not st.get("alive"):
            yield {"_done": True, "stop_reason": "ended"}
            return
        yield {}  # tick: keeps the loop alive so the disconnect check + refresh run


@app.post("/invoke")
async def invoke(body: InvokeBody, request: Request):
    prompt = _prompt_of(body)
    control = body.data is None  # no work, control plane only (cancel / attach)
    _sid = str(body.session_id)[:8] if body.session_id else "new"
    _kind = (
        "attach"
        if (control and body.force)
        else "cancel"
        if control
        else "steer"
        if body.force
        else "send"
    )
    print(f"[invoke {_sid}] {_kind} (control={control} force={body.force})", flush=True)

    # CONTROL PLANE (data is None): no session is created, no prompt runs.
    if control:
        if body.session_id is None:
            raise HTTPException(
                400, "control-plane invoke (data=null) requires a session_id"
            )
        sid = str(body.session_id)
        if await db.get_session(sid) is None:
            raise HTTPException(404, "no such session")
        st = (await locks.status_many([sid])).get(sid, {})
        if not body.force:
            # CANCEL (force=F): cancel the alive holder, run nothing. Cancel is a non-enforcement
            # control — it interrupts THIS session's own run, it doesn't override another tab — so
            # it lives on the force=F side and survives for callers without force support. (The
            # sidecar's own `force:True` below is its alive-lock "interrupt the holder" knob, a
            # different layer from our client-facing flag.)
            if not st.get("alive"):
                return _response(sid, status="no_live_run")
            async with httpx.AsyncClient(timeout=60) as client:
                r = await client.post(
                    f"{SIDECAR_URL}/run",
                    json={"session_id": sid, "data": None, "force": True},
                )
            ok = r.status_code == 200
            return _response(sid, status="cancelled" if ok else "cancel_failed")
        # ATTACH (force=T): adopt a live run's watch. `attached` is just "who is watching" (not a run
        # gate), so attach STEALS it — the prior watcher merely loses the live view. That steal is an
        # ENFORCEMENT over another tab, which is why attach is the force=T control (and the first
        # thing a no-force caller loses; cancel is kept instead).
        if not st.get("alive"):
            return _response(sid, status="no_live_run")
        # acquire (steal) `attached` up front, then watch — adopting the token so the loop refreshes
        # this one instead of grabbing another.
        token = str(uuid.uuid4())
        await locks.acquire_attached(sid, token)
        await _watch_attached(sid, request, _attach_poll(sid), token=token)
        st2 = (await locks.status_many([sid])).get(sid, {})
        if st2.get("alive"):
            return _response(sid, status="detached")  # we left, run continues
        return _response(sid, status="ended", stop_reason="ended")

    # DATA PLANE: a prompt to run (send / force-takeover).
    # null id -> mint + create with requested dimensions;
    # provided -> resume; sandbox/harness/provider/model/reasoning are FIXED to creation.
    p = body.data.parameters
    sandbox_id = None
    if body.session_id is None or (await db.get_session(str(body.session_id))) is None:
        sid = str(body.session_id) if body.session_id else str(uuid.uuid4())
        sandbox, harness = p.sandbox, p.harness
        provider, model, reasoning = p.provider, p.model, p.reasoning
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

    # STEER = detach A, attach B, cancel A, run B. On a force takeover, grab `attached` for THIS
    # tab NOW — before the sidecar's force-cancel (which can take seconds to re-acquire `alive`).
    # acquire_attached is an unconditional SET, so it displaces the prior watcher (A) immediately;
    # without this, A keeps `attached` for the whole cancel window and B looks unattached. We then
    # hand this token to _watch_attached so it adopts (doesn't re-acquire) it.
    attach_token = None
    if body.force:
        attach_token = str(uuid.uuid4())
        await locks.acquire_attached(sid, attach_token)

    done = None
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST",
            f"{SIDECAR_URL}/run",
            json={
                "session_id": sid,
                "prompt": prompt,
                "sandbox": sandbox,
                "harness": harness,
                "provider": provider,
                "model": model,
                "reasoning": reasoning,
                "sandbox_id": sandbox_id,
                "force": body.force,
            },
        ) as resp:
            # 409 = a run is already live for this session (and force wasn't set). The sidecar
            # body says WHICH kind of busy: a detached live run is `reattachable` (the driving
            # client left), an attached one is being watched. Surface that so the UI can offer
            # reattach vs. force. (httpx must read the streamed 409 body before we use it.)
            if resp.status_code == 409:
                # takeover failed (e.g. cancel timed out) — drop the attach we optimistically took
                if attach_token:
                    await locks.release_attached(sid, attach_token)
                await resp.aread()
                info = json.loads(resp.text or "{}")
                return JSONResponse(
                    status_code=409,
                    content=_response(
                        sid,
                        status="in_use",
                        extra={
                            "code": "in_use",
                            "alive": info.get("alive", True),
                            "attached": info.get("attached", False),
                            "reattachable": info.get("reattachable", False),
                            "detail": (
                                "session in use — detached, reattachable"
                                if info.get("reattachable")
                                else "session in use — another tab is attached"
                            ),
                        },
                    ),
                )

            # The run started: hold `attached` while this browser drains the live view. The view
            # is disposable (persistence is producer-driven via /events); we walk it only for the
            # final stop_reason, and detach (drop `attached`, keep the run) on browser disconnect.
            async def _ndjson():
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if line:
                        yield json.loads(line)

            done = await _watch_attached(sid, request, _ndjson(), token=attach_token)

    if done and done.get("error"):
        raise HTTPException(status_code=500, detail=done["error"])
    if not done:
        # we returned before the run finished (browser detached) — report detached, not done
        return _response(sid, status="detached")
    return _response(
        sid,
        status="done",
        text=done.get("text"),
        stop_reason=done.get("stop_reason"),
        events=done.get("events"),
    )


class EventBody(BaseModel):
    session_id: str
    event_index: int | None = None
    sender: str | None = None
    session_update: str | None = None
    payload: dict = {}


@app.post("/events")
async def ingest_event(body: EventBody):
    # Producer-driven persistence: the sidecar POSTs every transcript event here as rivet
    # produces it — independent of any /invoke client. This is the durable transcript write;
    # /invoke no longer persists. Keeping the DB write here (not in the sidecar) keeps all SQL
    # in one place.
    await db.append_event(
        body.session_id,
        body.event_index,
        body.sender,
        body.session_update,
        body.payload or {},
    )
    return {"ok": True}


class SandboxIdBody(BaseModel):
    sandbox_id: str | None = None


@app.put("/sessions/{sid}/sandbox-id")
async def put_sandbox_id(sid: str, body: SandboxIdBody):
    # The sidecar records the remote sandbox id (for resume) here, independent of the view
    # stream, so a detached run still persists where it ran. null clears it (docker teardown).
    await db.set_sandbox_id(sid, body.sandbox_id)
    return {"ok": True}


@app.get("/sessions")
async def sessions():
    rows = await db.list_sessions()
    # enrich with run-lock state: run_alive = a run is executing now; attached = a browser is
    # watching it; reattachable = live but unwatched (a returning tab can adopt the stream).
    # (db's own `live` is sandbox-aliveness for the kill badge — a different axis.)
    st = await locks.status_many([r["id"] for r in rows])
    for r in rows:
        s = st.get(r["id"], {})
        r["run_alive"] = s.get("alive", False)
        r["attached"] = s.get("attached", False)
        r["reattachable"] = s.get("reattachable", False)
    return {"sessions": rows}


@app.delete("/sessions/{sid}/sandbox")
async def kill_sandbox(sid: str):
    # Destroy the remote sandbox; the cwd stays durable in SeaweedFS, so the next
    # /invoke spins a fresh sandbox and remounts the same prefix.
    row = await db.get_session(sid)
    if row is None:
        raise HTTPException(404, "no such session")
    if not row["sandbox_id"]:
        return {"killed": None, "note": "no live sandbox for this session"}
    # The sidecar /kill is idempotent (a sandbox already gone reports success). Clear the
    # persisted sandbox_id regardless so the "live" badge / kill button don't get stranded
    # on a dead sandbox; surface a sidecar failure as a note rather than blocking cleanup.
    note = None
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{SIDECAR_URL}/kill",
                json={"sandbox": row["sandbox"], "sandbox_id": row["sandbox_id"]},
            )
            r.raise_for_status()
    except httpx.HTTPError as e:
        note = f"sidecar kill error (cleared anyway): {e}"
    await db.set_sandbox_id(sid, None)
    return {"killed": row["sandbox_id"], "note": note}


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


# The sandbox-agent SDK's per-session record (its SessionPersistDriver state). The sidecar
# spins a fresh SDK client every /run, so it round-trips this record through here to make
# resumeOrCreateSession actually resume (and replay the transcript) instead of starting cold.
@app.get("/sessions/{sid}/state")
async def get_state(sid: str):
    return {"record": await db.get_session_state(sid)}


@app.put("/sessions/{sid}/state")
async def put_state(sid: str, body: dict):
    if not await db.session_exists(sid):
        raise HTTPException(404, "no such session")
    await db.set_session_state(sid, body)
    return {"ok": True}


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


@app.delete("/sessions/{sid}/files")
async def delete_file(sid: str, path: str):
    # Delete a file (or a whole folder prefix, trailing '/') from the cwd in SeaweedFS. The
    # change lands in the durable store; the next sandbox sees it via the geesefs mount.
    import aioboto3

    s = aioboto3.Session()
    async with s.client(
        "s3",
        endpoint_url=S3_URL,
        aws_access_key_id=S3_KEY,
        aws_secret_access_key=S3_SECRET,
        region_name="us-east-1",
    ) as s3:
        prefix = f"{sid}/{path}"
        resp = await s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=prefix)
        keys = [{"Key": o["Key"]} for o in resp.get("Contents", [])]
        if not keys:
            raise HTTPException(404, "no such file or folder")
        await s3.delete_objects(Bucket=S3_BUCKET, Delete={"Objects": keys})
        return {"deleted": path, "count": len(keys)}


# Static playground UI (filesystem viewer + invoke form + session list).
from fastapi.staticfiles import StaticFiles  # noqa: E402

app.mount("/", StaticFiles(directory="static", html=True), name="static")
