# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached, mechanism-level. No model discovery claim may cite this cell.

I2: six scripted interaction-card journeys against a live deployment.

This is a wire-level release cell, not a browser test. It cannot click, reload a tab, preserve
component memory, inspect card geometry, or observe the "running somewhere else" strip. Each
journey's own docstring names the browser action it represents and the browser-only claim it
cannot cover. A reload or reopen is represented by fresh reads of stored interaction rows and
session records. A browser answer is represented by the same ONE atomic `/transition` call the
browser sends before it resumes.

Rows that would be expensive or flaky to raise through model behaviour are created directly via
`POST /sessions/interactions/`. This cell pins lifecycle composition across several cards; the
separate L cells pin model/runner gate production and in-band resume mechanics.

The Telegram journey goes furthest: when `TELEGRAM_BOT_TOKEN` is set it validates the real bot
against Telegram's own API and drives Agenta's real `/tools/connections/` create, remove and
re-create. It stops at the one step a wire client must not take — entering the credential on the
provider's hosted page. Agenta never accepts a provider key in its own payload, so the only
headless route would be scraping that third-party page and posting a live secret into a guessed
field. The journey reports that gap in `not_covered` rather than faking it; the "connected for
real" half of qa.md journey 5 stays a human exploratory-QA step. The token is read only from the
process environment, never printed, never returned as evidence, and never read from a file. When
it is unset the journey returns `SKIP`, prints a loud warning, and makes the whole cell `SKIP`
rather than letting five passing stand-ins look like full coverage.

  uv run matrix_i2_card_journeys.py
"""

import json
import os
import pathlib
import sys
import time
import uuid

import httpx

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    agent_config,
    api_call,
    archive,
    create_workflow,
    interactions,
    invoke,
    refs,
    seed_and_baseline,
    user_msg,
)


class JourneyError(RuntimeError):
    pass


def apply_model_override(config: dict) -> dict:
    """Let a deployment without Anthropic subscription auth still run this cell.

    `agent_config` hardcodes the claude harness on subscription auth, which fails outright on a
    stack with no sidecar and no Anthropic vault key. Setting QA_HARNESS_KIND / QA_MODEL /
    QA_PROVIDER / QA_CONNECTION_MODE swaps in any other harness (e.g. codex + gpt-5.6-luna on a
    vault-managed OpenAI key). Unset, the config is returned untouched.
    """
    harness = os.environ.get("QA_HARNESS_KIND")
    model = os.environ.get("QA_MODEL")
    provider = os.environ.get("QA_PROVIDER")
    mode = os.environ.get("QA_CONNECTION_MODE")
    if harness:
        config["harness"] = {"kind": harness}
    if model:
        config["llm"]["model"] = model
    if provider:
        config["llm"]["provider"] = provider
    if mode:
        config["llm"]["connection"] = {"mode": mode, "slug": None}
    return config


def create_interaction(
    *, session_id: str, turn_id: str, token: str, kind: str, tool_name: str
) -> dict:
    response = api_call(
        "POST",
        "/sessions/interactions/",
        json={
            "session_id": session_id,
            "turn_id": turn_id,
            "token": token,
            "kind": kind,
            "data": {
                "request": {
                    "tool": tool_name,
                    "tool_call_id": f"call-{token}",
                }
            },
        },
    )
    if response.status_code != 200:
        raise JourneyError(
            f"create {kind} interaction HTTP {response.status_code}: {response.text[:240]}"
        )
    return response.json()["interaction"]


def transition(*, session_id: str, token: str, status: str, resolution: dict) -> dict:
    response = api_call(
        "POST",
        "/sessions/interactions/transition",
        json={
            "session_id": session_id,
            "token": token,
            "status": status,
            "resolution": resolution,
        },
    )
    if response.status_code != 200:
        raise JourneyError(
            f"transition interaction HTTP {response.status_code}: {response.text[:240]}"
        )
    return response.json()["interaction"]


def form_resolution(token: str, *, declined: bool = False) -> dict:
    return {
        "tool_call_id": f"call-{token}",
        "tool_name": "request_input",
        "outcome": "completed",
        "output": (
            {"action": "decline"}
            if declined
            else {"action": "accept", "content": {"timezone": "UTC"}}
        ),
    }


def connect_resolution(
    token: str, *, connected: bool, reason: str | None = None, slug: str = "telegram"
) -> dict:
    output = {"connected": connected, "integration": "telegram", "slug": slug}
    if reason is not None:
        output["reason"] = reason
    return {
        "tool_call_id": f"call-{token}",
        "tool_name": "request_connection",
        "outcome": "completed",
        "output": output,
    }


def approval_resolution(token: str, *, approved: bool) -> dict:
    return {
        "verdict": "approved" if approved else "denied",
        "tool_call_id": f"call-{token}",
    }


def row_by_token(rows: list[dict], token: str) -> dict | None:
    return next((row for row in rows if row.get("token") == token), None)


def saved_resolution(row: dict | None) -> dict | None:
    return ((row or {}).get("data") or {}).get("resolution")


def query_records(session_id: str) -> list[dict]:
    response = api_call(
        "POST",
        "/sessions/records/query",
        json={"session_id": session_id},
    )
    if response.status_code != 200:
        raise JourneyError(
            f"query session records HTTP {response.status_code}: {response.text[:240]}"
        )
    return response.json().get("records") or []


def await_records(session_id: str, seconds: float = 20.0) -> list[dict]:
    deadline = time.time() + seconds
    records = query_records(session_id)
    while not records and time.time() < deadline:
        time.sleep(1.0)
        records = query_records(session_id)
    return records


def journey_compound(parameters: dict, references: dict) -> dict:
    """Stand-in for form -> browser reload -> connect decline -> resume -> schedule approval ->
    reload. Fresh row/record queries represent reloads, and a same-session live turn proves the
    session remains usable after decline. It cannot assert widget rendering, automatic browser
    resume composition, card multiplicity on screen, or the ownership warning strip."""
    session_id = str(uuid.uuid4())
    form_token = f"i2-compound-form-{uuid.uuid4().hex[:8]}"
    connect_token = f"i2-compound-connect-{uuid.uuid4().hex[:8]}"
    approval_token = f"i2-compound-approval-{uuid.uuid4().hex[:8]}"

    messages = [user_msg("Reply with exactly: AGENT_READY")]
    first_turn = invoke(session_id, messages, parameters, references, log=False)
    if first_turn.errors:
        return {
            "status": "FAIL",
            "why": f"agent creation turn errored: {first_turn.errors[:1]}",
            "session_id": session_id,
        }

    create_interaction(
        session_id=session_id,
        turn_id="turn-form",
        token=form_token,
        kind="user_input",
        tool_name="request_input",
    )
    form_answer = form_resolution(form_token)
    transition(
        session_id=session_id,
        token=form_token,
        status="responded",
        resolution=form_answer,
    )
    first_reload_rows = interactions(session_id)
    first_reload_records = await_records(session_id)

    create_interaction(
        session_id=session_id,
        turn_id="turn-connect",
        token=connect_token,
        kind="client_tool",
        tool_name="request_connection",
    )
    connect_decline = connect_resolution(
        connect_token, connected=False, reason="declined"
    )
    transition(
        session_id=session_id,
        token=connect_token,
        status="responded",
        resolution=connect_decline,
    )

    resumed_messages = messages + [
        first_turn.assistant_message(),
        user_msg("Reply with exactly: RESUMED"),
    ]
    resumed_turn = invoke(
        session_id,
        resumed_messages,
        parameters,
        references,
        log=False,
    )

    create_interaction(
        session_id=session_id,
        turn_id="turn-schedule",
        token=approval_token,
        kind="user_approval",
        tool_name="create_schedule",
    )
    schedule_approval = approval_resolution(approval_token, approved=True)
    transition(
        session_id=session_id,
        token=approval_token,
        status="resolved",
        resolution=schedule_approval,
    )
    final_rows = interactions(session_id)
    final_records = await_records(session_id)

    first_form = row_by_token(first_reload_rows, form_token)
    form = row_by_token(final_rows, form_token)
    connect = row_by_token(final_rows, connect_token)
    approval = row_by_token(final_rows, approval_token)
    checks = {
        "first_reload_form_responded": (
            (first_form or {}).get("status") == "responded"
            and saved_resolution(first_form) == form_answer
        ),
        "form_remained_responded": (
            (form or {}).get("status") == "responded"
            and saved_resolution(form) == form_answer
        ),
        "connect_decline_saved": (
            (connect or {}).get("status") == "responded"
            and saved_resolution(connect) == connect_decline
        ),
        "schedule_approval_saved": (
            (approval or {}).get("status") == "resolved"
            and saved_resolution(approval) == schedule_approval
        ),
        "run_resumed": not resumed_turn.errors
        and "RESUMED" in resumed_turn.reply.upper(),
        "records_survived_both_reads": bool(first_reload_records and final_records),
    }
    ok = all(checks.values())
    return {
        "status": "PASS" if ok else "FAIL",
        "why": (
            "form, connect decline, and schedule approval survived both durable rereads and the "
            "same session completed a later turn"
            if ok
            else f"compound journey checks failed: {checks}"
        ),
        "session_id": session_id,
        "checks": checks,
        "final_states": {
            form_token: (form or {}).get("status"),
            connect_token: (connect or {}).get("status"),
            approval_token: (approval or {}).get("status"),
        },
        "record_counts": [len(first_reload_records), len(final_records)],
        "resume_errors": resumed_turn.errors,
    }


def journey_form_then_connect() -> dict:
    """Stand-in for two back-to-back rendered cards. Direct row creation represents each card,
    and a fresh query represents the browser rebuilding its state. It cannot assert that the form
    fields or connect widget render correctly or that the queue blocks the composer."""
    session_id = str(uuid.uuid4())
    form_token = f"i2-back-form-{uuid.uuid4().hex[:8]}"
    connect_token = f"i2-back-connect-{uuid.uuid4().hex[:8]}"
    create_interaction(
        session_id=session_id,
        turn_id="turn-form",
        token=form_token,
        kind="user_input",
        tool_name="request_input",
    )
    form_answer = form_resolution(form_token)
    transition(
        session_id=session_id,
        token=form_token,
        status="responded",
        resolution=form_answer,
    )
    create_interaction(
        session_id=session_id,
        turn_id="turn-connect",
        token=connect_token,
        kind="client_tool",
        tool_name="request_connection",
    )
    rows = interactions(session_id)
    form = row_by_token(rows, form_token)
    connect = row_by_token(rows, connect_token)
    pending = [row.get("token") for row in rows if row.get("status") == "pending"]
    ok = (
        (form or {}).get("status") == "responded"
        and saved_resolution(form) == form_answer
        and (connect or {}).get("status") == "pending"
        and pending == [connect_token]
    )
    return {
        "status": "PASS" if ok else "FAIL",
        "why": (
            "the answered form stayed answered and only the following connect row remained live"
            if ok
            else (
                f"form_status={(form or {}).get('status')!r}, "
                f"form_resolution={saved_resolution(form)!r}, "
                f"connect_status={(connect or {}).get('status')!r}, pending={pending}"
            )
        ),
        "session_id": session_id,
        "pending_tokens": pending,
    }


def journey_two_connects() -> dict:
    """Stand-in for two connect widgets in one conversation. Independent row tokens represent
    the two visible cards; reads after each transition represent UI reconciliation. It cannot
    assert popup isolation, component-local double-settle guards, or visual card identity."""
    session_id = str(uuid.uuid4())
    first_token = f"i2-connect-a-{uuid.uuid4().hex[:8]}"
    second_token = f"i2-connect-b-{uuid.uuid4().hex[:8]}"
    for turn_id, token in (("turn-a", first_token), ("turn-b", second_token)):
        create_interaction(
            session_id=session_id,
            turn_id=turn_id,
            token=token,
            kind="client_tool",
            tool_name="request_connection",
        )
    first_answer = connect_resolution(first_token, connected=True, slug="telegram-a")
    second_answer = connect_resolution(second_token, connected=True, slug="telegram-b")
    transition(
        session_id=session_id,
        token=first_token,
        status="responded",
        resolution=first_answer,
    )
    after_first = interactions(session_id)
    transition(
        session_id=session_id,
        token=second_token,
        status="responded",
        resolution=second_answer,
    )
    after_both = interactions(session_id)

    first_mid = row_by_token(after_first, first_token)
    second_mid = row_by_token(after_first, second_token)
    first_final = row_by_token(after_both, first_token)
    second_final = row_by_token(after_both, second_token)
    checks = {
        "first_settled_alone": (
            (first_mid or {}).get("status") == "responded"
            and saved_resolution(first_mid) == first_answer
        ),
        "second_untouched_until_answered": (second_mid or {}).get("status")
        == "pending",
        "first_never_reverted": (
            (first_final or {}).get("status") == "responded"
            and saved_resolution(first_final) == first_answer
        ),
        "second_settled_independently": (
            (second_final or {}).get("status") == "responded"
            and saved_resolution(second_final) == second_answer
        ),
    }
    ok = all(checks.values())
    return {
        "status": "PASS" if ok else "FAIL",
        "why": (
            "each connect row settled independently and neither answer touched or reverted the other"
            if ok
            else f"two-connect checks failed: {checks}"
        ),
        "session_id": session_id,
        "checks": checks,
    }


def journey_close_and_reopen(parameters: dict, references: dict) -> dict:
    """Stand-in for closing and reopening the browser tab. Two fresh row and record queries
    represent new-tab hydration after one answered card and one parked card. It cannot prove the
    parked widget is clickable, drafts survive local storage, or a real tab discarded memory."""
    session_id = str(uuid.uuid4())
    answered_token = f"i2-reopen-answered-{uuid.uuid4().hex[:8]}"
    parked_token = f"i2-reopen-parked-{uuid.uuid4().hex[:8]}"

    turn = invoke(
        session_id,
        [user_msg("Reply with exactly: DURABLE")],
        parameters,
        references,
        log=False,
    )
    if turn.errors:
        return {
            "status": "FAIL",
            "why": f"record-producing turn errored: {turn.errors[:1]}",
            "session_id": session_id,
        }
    create_interaction(
        session_id=session_id,
        turn_id="turn-answered",
        token=answered_token,
        kind="client_tool",
        tool_name="request_connection",
    )
    answered_resolution = connect_resolution(answered_token, connected=True)
    transition(
        session_id=session_id,
        token=answered_token,
        status="responded",
        resolution=answered_resolution,
    )
    rows_after_answer = interactions(session_id)
    records_after_answer = await_records(session_id)

    create_interaction(
        session_id=session_id,
        turn_id="turn-parked",
        token=parked_token,
        kind="client_tool",
        tool_name="request_connection",
    )
    rows_after_reopen = interactions(session_id)
    records_after_reopen = query_records(session_id)
    answered = row_by_token(rows_after_reopen, answered_token)
    parked = row_by_token(rows_after_reopen, parked_token)
    checks = {
        "answered_before_close": (
            (row_by_token(rows_after_answer, answered_token) or {}).get("status")
            == "responded"
        ),
        "answered_after_reopen": (
            (answered or {}).get("status") == "responded"
            and saved_resolution(answered) == answered_resolution
        ),
        "parked_after_reopen": (
            (parked or {}).get("status") == "pending"
            and saved_resolution(parked) is None
        ),
        "records_reread": bool(records_after_answer and records_after_reopen),
    }
    ok = all(checks.values())
    return {
        "status": "PASS" if ok else "FAIL",
        "why": (
            "fresh reads kept the answered card dead and the parked card live"
            if ok
            else f"close/reopen checks failed: {checks}"
        ),
        "session_id": session_id,
        "checks": checks,
        "record_counts": [len(records_after_answer), len(records_after_reopen)],
    }


def validate_telegram_bot(token: str) -> dict:
    try:
        response = httpx.get(
            f"https://api.telegram.org/bot{token}/getMe",
            timeout=20.0,
        )
    except Exception as error:  # noqa: BLE001
        raise JourneyError(
            f"Telegram Bot API request failed ({type(error).__name__}); token was not printed"
        ) from None
    payload = response.json() if response.status_code == 200 else {}
    if response.status_code != 200 or not payload.get("ok"):
        raise JourneyError(
            f"Telegram rejected TELEGRAM_BOT_TOKEN with HTTP {response.status_code}"
        )
    bot = payload.get("result") or {}
    return {"id": bot.get("id"), "username": bot.get("username")}


def create_real_telegram_connection(slug: str) -> dict:
    """Drive the product's real connection-create call and return the pending connection.

    The credential itself is deliberately NOT sent from here. Agenta never accepts a provider
    API key in this payload — the service comment is explicit that the key is entered on the
    provider's hosted redirect UI — so a wire client could only deliver it by scraping that
    third-party page and guessing which field to post a live secret into. This cell refuses to
    do that; see the journey's `not_covered` field."""
    response = api_call(
        "POST",
        "/tools/connections/",
        json={
            "connection": {
                "slug": slug,
                "name": slug,
                "provider_key": "composio",
                "integration_key": "telegram",
                "data": {"auth_scheme": "api_key"},
            }
        },
    )
    if response.status_code != 200:
        raise JourneyError(
            f"create Telegram connection HTTP {response.status_code}; response omitted to avoid "
            "leaking provider context"
        )
    connection = response.json()["connection"]
    if not (connection.get("data") or {}).get("redirect_url"):
        delete_connection(connection["id"])
        raise JourneyError(
            "the Telegram connection came back with no hosted credential URL, so the browser "
            "step a user would take does not exist"
        )
    return connection


def delete_connection(connection_id: str) -> int:
    response = api_call("DELETE", f"/tools/connections/{connection_id}")
    return response.status_code


def journey_real_telegram() -> dict:
    """Wire-level stand-in for: click Connect, enter a real Telegram bot token, remove the
    connection, ask again.

    What it really covers: the bot token is validated against Telegram's own API (proving the
    credential is real and live), Agenta's real `/tools/connections/` create returns a pending
    connection with a hosted credential URL, the connection is removed, a second one is created,
    and both client-tool rows settle through the same atomic `/transition` the browser sends.

    What it CANNOT cover, by design: entering the credential on the provider's hosted page. That
    is a browser step — Agenta never accepts the key in its own payload — and the only headless
    route would be scraping a third-party form and posting a live secret into a guessed field.
    So the connection never reaches `is_valid`, and the "connected for real" half of qa.md
    journey 5 stays a human exploratory-QA step. The journey reports that gap in `not_covered`
    instead of pretending to cover it.

    The token is read only from the process environment, never printed, never returned as
    evidence, and never read from a file."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        warning = (
            "WARNING: I2 TELEGRAM JOURNEY SKIPPED. TELEGRAM_BOT_TOKEN is unset, so real "
            "connect / remove / reconnect DID NOT RUN. This is untested coverage, not a pass."
        )
        print(f"\n{'!' * 88}\n{warning}\n{'!' * 88}\n", file=sys.stderr)
        return {"status": "SKIP", "why": warning}

    session_id = str(uuid.uuid4())
    created_ids: list[str] = []
    try:
        bot = validate_telegram_bot(token)
        first_token = f"i2-telegram-first-{uuid.uuid4().hex[:8]}"
        create_interaction(
            session_id=session_id,
            turn_id="turn-telegram-first",
            token=first_token,
            kind="client_tool",
            tool_name="request_connection",
        )
        first = create_real_telegram_connection(f"qa-telegram-{uuid.uuid4().hex[:8]}")
        created_ids.append(first["id"])
        # The browser would settle the card with the connection it just completed; here the
        # recorded outcome names the connection that WAS created, credential entry aside.
        first_answer = connect_resolution(
            first_token,
            connected=True,
            slug=first["slug"],
        )
        transition(
            session_id=session_id,
            token=first_token,
            status="responded",
            resolution=first_answer,
        )
        first_delete = delete_connection(first["id"])
        if first_delete == 204:
            created_ids.remove(first["id"])

        second_token = f"i2-telegram-second-{uuid.uuid4().hex[:8]}"
        create_interaction(
            session_id=session_id,
            turn_id="turn-telegram-second",
            token=second_token,
            kind="client_tool",
            tool_name="request_connection",
        )
        second = create_real_telegram_connection(f"qa-telegram-{uuid.uuid4().hex[:8]}")
        created_ids.append(second["id"])
        second_answer = connect_resolution(
            second_token,
            connected=True,
            slug=second["slug"],
        )
        transition(
            session_id=session_id,
            token=second_token,
            status="responded",
            resolution=second_answer,
        )
        rows = interactions(session_id)
        first_row = row_by_token(rows, first_token)
        second_row = row_by_token(rows, second_token)
        checks = {
            "real_bot_validated": bool(bot.get("id")),
            "first_connection_created": bool(first.get("id")),
            "first_removed": first_delete == 204,
            "second_connection_created": bool(second.get("id")),
            "reconnect_is_a_fresh_connection": first.get("id") != second.get("id"),
            "first_row_settled": (
                (first_row or {}).get("status") == "responded"
                and saved_resolution(first_row) == first_answer
            ),
            "second_row_settled": (
                (second_row or {}).get("status") == "responded"
                and saved_resolution(second_row) == second_answer
            ),
        }
        ok = all(checks.values())
        return {
            "status": "PASS" if ok else "FAIL",
            "why": (
                "a real Telegram bot was validated, a connection was created, removed and "
                "recreated, and both card outcomes are stored"
                if ok
                else f"real Telegram checks failed: {checks}"
            ),
            "session_id": session_id,
            "bot_id": bot.get("id"),
            "bot_username": bot.get("username"),
            "checks": checks,
            "not_covered": (
                "entering the bot token on the provider's hosted page, and therefore the "
                "connection reaching is_valid. That is a browser step; run qa.md journey 5 by "
                "hand during exploratory QA."
            ),
        }
    except JourneyError as error:
        return {
            "status": "FAIL",
            "why": str(error),
            "session_id": session_id,
        }
    except Exception as error:  # noqa: BLE001
        return {
            "status": "FAIL",
            "why": (
                f"unexpected Telegram journey error ({type(error).__name__}); details omitted "
                "so TELEGRAM_BOT_TOKEN cannot appear in output"
            ),
            "session_id": session_id,
        }
    finally:
        for connection_id in created_ids:
            delete_connection(connection_id)


def journey_decline_then_retry() -> dict:
    """Stand-in for clicking Not now and then Retry. The retry is represented by creation of one
    fresh row after the decline settles; fresh queries prove the old row stays dead. It cannot
    assert the Retry button is visible/clickable or that a model re-asked at the right time."""
    session_id = str(uuid.uuid4())
    declined_token = f"i2-decline-{uuid.uuid4().hex[:8]}"
    retry_token = f"i2-retry-{uuid.uuid4().hex[:8]}"
    create_interaction(
        session_id=session_id,
        turn_id="turn-decline",
        token=declined_token,
        kind="client_tool",
        tool_name="request_connection",
    )
    decline = connect_resolution(declined_token, connected=False, reason="declined")
    transition(
        session_id=session_id,
        token=declined_token,
        status="responded",
        resolution=decline,
    )
    create_interaction(
        session_id=session_id,
        turn_id="turn-retry",
        token=retry_token,
        kind="client_tool",
        tool_name="request_connection",
    )
    rows = interactions(session_id)
    declined = row_by_token(rows, declined_token)
    retry = row_by_token(rows, retry_token)
    live = [row.get("token") for row in rows if row.get("status") == "pending"]
    ok = (
        (declined or {}).get("status") == "responded"
        and saved_resolution(declined) == decline
        and (retry or {}).get("status") == "pending"
        and live == [retry_token]
    )
    return {
        "status": "PASS" if ok else "FAIL",
        "why": (
            "the decline stayed settled and retry created exactly one new live row"
            if ok
            else (
                f"declined_status={(declined or {}).get('status')!r}, "
                f"declined_resolution={saved_resolution(declined)!r}, "
                f"retry_status={(retry or {}).get('status')!r}, live={live}"
            )
        ),
        "session_id": session_id,
        "live_tokens": live,
    }


def capture_journey(function, *args) -> dict:
    try:
        return function(*args)
    except Exception as error:  # noqa: BLE001
        return {
            "status": "FAIL",
            "why": f"unhandled {function.__name__} error: {type(error).__name__}: {error}",
        }


def i2() -> dict:
    hexid = uuid.uuid4().hex[:8]
    workflow_id, variant_id = create_workflow(hexid, "qa-i2")
    try:
        config = agent_config(
            instructions="Be terse. Reply with exactly what is requested."
        )
        config = apply_model_override(config)
        revision_id, _ = seed_and_baseline(workflow_id, variant_id, config, hexid)
        parameters = {"agent": config}
        references = refs(workflow_id, variant_id, revision_id)
        journeys = {
            "compound": capture_journey(journey_compound, parameters, references),
            "form_then_connect": capture_journey(journey_form_then_connect),
            "two_connects": capture_journey(journey_two_connects),
            "close_and_reopen": capture_journey(
                journey_close_and_reopen, parameters, references
            ),
            "real_telegram": capture_journey(journey_real_telegram),
            "decline_then_retry": capture_journey(journey_decline_then_retry),
        }
        failures = [
            name for name, result in journeys.items() if result["status"] == "FAIL"
        ]
        skips = [
            name for name, result in journeys.items() if result["status"] == "SKIP"
        ]
        passes = [
            name for name, result in journeys.items() if result["status"] == "PASS"
        ]
        status = "FAIL" if failures else "SKIP" if skips else "PASS"
        if failures:
            why = " | ".join(f"{name}: {journeys[name]['why']}" for name in failures)
        elif skips:
            why = (
                f"{len(passes)} journeys passed; {len(skips)} SKIPPED AND UNTESTED: "
                + ", ".join(skips)
            )
        else:
            why = "all six card journeys matched their stored-row and record contracts"
        return {
            "status": status,
            "why": why,
            "workflow_id": workflow_id,
            "summary": {
                "passed": passes,
                "failed": failures,
                "skipped_untested": skips,
            },
            "journeys": journeys,
        }
    finally:
        archive(workflow_id)


if __name__ == "__main__":
    try:
        result = i2()
    except Exception as error:  # noqa: BLE001
        result = {
            "status": "FAIL",
            "why": f"unhandled exception: {type(error).__name__}: {error}",
        }
    print("\n=== I2 RESULT ===")
    print(json.dumps(result, indent=2, default=str))
    sys.exit(0 if result["status"] in ("PASS", "SKIP") else 1)
