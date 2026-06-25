import json
import os
import struct
import time
import uuid

import asyncpg

DSN = f"{os.environ['POSTGRES_URI'].rstrip('/')}/{os.environ['POSTGRES_DB']}"


def uuid7() -> uuid.UUID:
    # Time-ordered UUIDv7: 48-bit ms timestamp + version/variant + random.
    ms = int(time.time() * 1000)
    rand = uuid.uuid4().bytes
    b = struct.pack(">Q", ms)[2:] + rand[6:]  # 6 ts bytes + 10 random bytes
    b = bytearray(b)
    b[6] = (b[6] & 0x0F) | 0x70  # version 7
    b[8] = (b[8] & 0x3F) | 0x80  # RFC 4122 variant
    return uuid.UUID(bytes=bytes(b))


SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY,
  sandbox       TEXT NOT NULL DEFAULT 'local',     -- where it runs: local | modal | e2b | daytona
  harness       TEXT NOT NULL DEFAULT 'claude',    -- coding agent: claude | codex | opencode | pi
  runner        TEXT NOT NULL DEFAULT 'local',     -- derived: local (sandbox=local) | rivet
  provider      TEXT NOT NULL DEFAULT 'anthropic', -- LLM API: anthropic | openai
  model         TEXT,                              -- model id (keyed by provider)
  reasoning     TEXT NOT NULL DEFAULT 'none',      -- thoughtLevel: none | low | medium | high
  cwd           TEXT NOT NULL,
  bucket_prefix TEXT NOT NULL,
  sandbox_id    TEXT,                              -- remote sandbox id (modal/e2b) for resume
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No global sequence: id is a UUIDv7 (time-ordered), ordering is a per-session counter.
CREATE TABLE IF NOT EXISTS session_transcripts (
  id             UUID PRIMARY KEY,
  session_id     UUID NOT NULL REFERENCES sessions(id),
  seq            INT  NOT NULL,             -- dense per-session index (count at insert)
  event_index    INT,                       -- agent's raw eventIndex (resets per resume)
  sender         TEXT,
  session_update TEXT,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);

-- The sandbox-agent SDK's per-session record (its SessionPersistDriver state): the
-- local-id -> agentSessionId mapping, sessionInit, modes, etc. It is metadata that rides
-- ALONGSIDE the transcript, not the transcript itself. Persisting it across the fresh
-- SandboxAgent.connect() each /run does is what lets resumeOrCreateSession actually RESUME
-- the prior agent session (and replay the transcript as context) instead of starting cold.
CREATE TABLE IF NOT EXISTS session_state (
  session_id UUID PRIMARY KEY REFERENCES sessions(id),
  record     JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

_pool: asyncpg.Pool | None = None


async def init():
    global _pool
    _pool = await asyncpg.create_pool(DSN, min_size=1, max_size=5)
    async with _pool.acquire() as con:
        await con.execute(SCHEMA)


async def pool() -> asyncpg.Pool:
    assert _pool is not None
    return _pool


async def create_session(
    sid: str,
    cwd: str,
    prefix: str,
    sandbox: str,
    harness: str,
    runner: str = "local",
    provider: str = "anthropic",
    model: str | None = None,
    reasoning: str = "none",
):
    async with (await pool()).acquire() as con:
        await con.execute(
            """INSERT INTO sessions
                 (id, sandbox, harness, runner, provider, model, reasoning, cwd, bucket_prefix)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING""",
            sid,
            sandbox,
            harness,
            runner,
            provider,
            model,
            reasoning,
            cwd,
            prefix,
        )


async def get_session(sid: str):
    async with (await pool()).acquire() as con:
        return await con.fetchrow(
            """SELECT id, sandbox, harness, runner, provider, model, reasoning,
                      cwd, bucket_prefix, sandbox_id FROM sessions WHERE id = $1""",
            sid,
        )


async def set_sandbox_id(sid: str, sandbox_id: str):
    async with (await pool()).acquire() as con:
        await con.execute(
            "UPDATE sessions SET sandbox_id = $2 WHERE id = $1", sid, sandbox_id
        )


async def session_exists(sid: str) -> bool:
    return (await get_session(sid)) is not None


async def delete_session(sid: str):
    async with (await pool()).acquire() as con:
        await con.execute("DELETE FROM session_state WHERE session_id = $1", sid)
        await con.execute("DELETE FROM session_transcripts WHERE session_id = $1", sid)
        await con.execute("DELETE FROM sessions WHERE id = $1", sid)


async def get_session_state(sid: str):
    # The SDK SessionRecord (JSON), or None if the session has never been persisted.
    async with (await pool()).acquire() as con:
        row = await con.fetchrow(
            "SELECT record FROM session_state WHERE session_id = $1", sid
        )
        if row is None:
            return None
        rec = row["record"]
        return json.loads(rec) if isinstance(rec, str) else rec


async def set_session_state(sid: str, record: dict):
    async with (await pool()).acquire() as con:
        await con.execute(
            """INSERT INTO session_state (session_id, record, updated_at)
               VALUES ($1, $2, now())
               ON CONFLICT (session_id)
               DO UPDATE SET record = EXCLUDED.record, updated_at = now()""",
            sid,
            json.dumps(record),
        )


async def append_event(sid: str, event_index, sender, session_update, payload: dict):
    # seq = current count of this session's events (dense, monotonic per session).
    async with (await pool()).acquire() as con:
        seq = await con.fetchval(
            "SELECT count(*) FROM session_transcripts WHERE session_id = $1", sid
        )
        await con.execute(
            """INSERT INTO session_transcripts
                 (id, session_id, seq, event_index, sender, session_update, payload)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (session_id, seq) DO NOTHING""",
            uuid7(),
            sid,
            seq,
            event_index,
            sender,
            session_update,
            json.dumps(payload),
        )
        await con.execute("UPDATE sessions SET updated_at = now() WHERE id = $1", sid)


# A remote sandbox is treated as "live" only for this window after the session's last
# activity. Cloud sandboxes auto-stop/pause on their own (e2b auto-pause, daytona
# autoStop), so a recorded sandbox_id past this TTL is almost certainly dead — we drop the
# live badge / kill button rather than probe each one per refresh. Resume still works
# regardless (it recreates + remounts the durable cwd).
SANDBOX_LIVE_TTL_SECONDS = 5 * 60


async def list_sessions():
    import datetime

    now = datetime.datetime.now(datetime.timezone.utc)
    async with (await pool()).acquire() as con:
        rows = await con.fetch(
            """SELECT s.id, s.sandbox, s.harness, s.runner, s.provider, s.model, s.reasoning,
                      s.cwd, s.bucket_prefix, s.sandbox_id,
                      s.status, s.updated_at, count(t.id) AS events
               FROM sessions s LEFT JOIN session_transcripts t ON t.session_id = s.id
               GROUP BY s.id ORDER BY s.updated_at DESC"""
        )
        out = []
        for r in rows:
            fresh = (now - r["updated_at"]).total_seconds() < SANDBOX_LIVE_TTL_SECONDS
            live = bool(r["sandbox_id"]) and fresh
            out.append(
                {
                    "id": str(r["id"]),
                    "sandbox": r["sandbox"],
                    "harness": r["harness"],
                    "runner": r["runner"],
                    "provider": r["provider"],
                    "model": r["model"],
                    "reasoning": r["reasoning"],
                    "cwd": r["cwd"],
                    "bucket_prefix": r["bucket_prefix"],
                    "sandbox_id": r["sandbox_id"],
                    "live": live,  # sandbox_id recorded AND within the live TTL
                    "status": r["status"],
                    "updated_at": r["updated_at"].isoformat(),
                    "events": r["events"],
                }
            )
        return out


async def get_transcript(sid: str):
    async with (await pool()).acquire() as con:
        rows = await con.fetch(
            """SELECT seq, event_index, sender, session_update, payload, created_at
               FROM session_transcripts WHERE session_id = $1
               ORDER BY seq""",
            sid,
        )
        return [
            {
                "seq": r["seq"],
                "event_index": r["event_index"],
                "sender": r["sender"],
                "session_update": r["session_update"],
                "payload": json.loads(r["payload"])
                if isinstance(r["payload"], str)
                else r["payload"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ]
