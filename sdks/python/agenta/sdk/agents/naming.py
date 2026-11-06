"""Name a new session, and a new agent, with one small model call beside the first turn.

The agent's own model used to name the session with the ``rename_session`` and
``rename_agent`` tools. A tool call ends the model call, so on most first turns the reply
waited for a second model call. This module takes that work out of the turn: on the first turn
of an unnamed session the agent service starts one small call that reads only the first user
message, and writes the names with the same endpoints the rename tools used.

Which model the call uses (the utility model):

1. ``AGENTA_UTILITY_MODEL_API_URL`` and ``AGENTA_UTILITY_MODEL`` set: that OpenAI-compatible
   endpoint, with ``AGENTA_UTILITY_MODEL_API_KEY`` as the bearer key when it is set.
2. Only ``AGENTA_UTILITY_MODEL`` set: that model on the built-in ``agenta`` provider, through
   the LLM gateway, with the run's own gateway credential.
3. Nothing set: the run's own model connection, when it speaks the OpenAI protocol and holds
   a key this process can send. Otherwise no call runs.

A call that runs no name keeps the runner's temporary title (the first message, cut to 60
characters). Every failure goes to the log, never to the person.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Optional
from urllib.parse import quote

import httpx

from agenta.sdk.agents.connections import (
    ModelRef,
    ResolvedConnection,
    RuntimeAuthContext,
)
from agenta.sdk.agents.connections.models import Connection
from agenta.sdk.agents.platform.connection import PlatformConnection
from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)

UTILITY_MODEL_ENV = "AGENTA_UTILITY_MODEL"
UTILITY_MODEL_API_URL_ENV = "AGENTA_UTILITY_MODEL_API_URL"
UTILITY_MODEL_API_KEY_ENV = "AGENTA_UTILITY_MODEL_API_KEY"

# The platform's own provider, as the gateway names it (`builtin/agenta`).
BUILTIN_PROVIDER_SLUG = "agenta"
OPENAI_BASE_URL = "https://api.openai.com/v1"

# The model call. The turn never waits for it.
NAMING_TIMEOUT_SECONDS = 10.0
# How long the names wait for the runner's first frame. A cold sandbox can take this long.
RUNNER_WAIT_SECONDS = 120.0
# The names take about 60 tokens. The cap leaves room for a model that still thinks a little.
MAX_OUTPUT_TOKENS = 200
MAX_MESSAGE_CHARS = 2000
MAX_NAME_CHARS = 60
MAX_DESCRIPTION_CHARS = 300

_PROMPT = """You name chat sessions in a product where people talk to AI agents.
Read the person's first message and reply with one JSON object and nothing else:
{"session_name": "...", "description": "..."%s}

- session_name: the subject of the session in a few words, as a person would scan it in a list. At most 60 characters. Not a sentence.
- description: what the person wants, in one short sentence.%s
- When the message does not say what the session is about (a greeting such as "hi", a test such as "ok"), reply {}.
- Write the names in the language of the message."""

_AGENT_FIELD = ', "agent_name": "..."'
_AGENT_RULE = (
    "\n- agent_name: a short name for the assistant that would help with this, "
    'such as "Release QA Assistant". At most 60 characters.'
)

_JSON_OBJECT = re.compile(r"\{.*\}", re.DOTALL)


@dataclass(frozen=True)
class UtilityModelRoute:
    """Where the naming call goes: an OpenAI-compatible base URL, a model and its auth."""

    base_url: str
    model: str
    headers: Dict[str, str]


@dataclass(frozen=True)
class ProposedNames:
    session_name: str
    description: Optional[str] = None
    agent_name: Optional[str] = None


def configured_route() -> Optional[UtilityModelRoute]:
    """The endpoint the deployment configured, or ``None`` when it configured no URL."""
    base_url = (os.getenv(UTILITY_MODEL_API_URL_ENV) or "").strip().rstrip("/")
    model = (os.getenv(UTILITY_MODEL_ENV) or "").strip()
    if not base_url:
        return None
    if not model:
        log.warning(
            "agent naming: %s is set without %s; no naming call",
            UTILITY_MODEL_API_URL_ENV,
            UTILITY_MODEL_ENV,
        )
        return None
    api_key = (os.getenv(UTILITY_MODEL_API_KEY_ENV) or "").strip()
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    return UtilityModelRoute(base_url=base_url, model=model, headers=headers)


def builtin_model() -> Optional[str]:
    """The built-in model to call, when only ``AGENTA_UTILITY_MODEL`` is set."""
    if (os.getenv(UTILITY_MODEL_API_URL_ENV) or "").strip():
        return None
    return (os.getenv(UTILITY_MODEL_ENV) or "").strip() or None


def route_from_connection(
    resolved: Optional[ResolvedConnection],
    *,
    platform: PlatformConnection,
) -> Optional[UtilityModelRoute]:
    """An OpenAI-protocol route over a resolved model connection, or ``None``.

    A gateway route carries our own gateway credential; a direct OpenAI connection carries the
    provider key. A subscription login, a harness-owned login and every other provider family
    give no route: this process cannot call them with the OpenAI protocol.
    """
    if resolved is None or resolved.provider != "openai":
        return None
    base_url = resolved.endpoint.base_url if resolved.endpoint else None
    if resolved.gateway_credentials is not None:
        if not base_url:
            return None
        return UtilityModelRoute(
            base_url=_internal_gateway_url(base_url, platform=platform),
            model=resolved.model,
            headers=resolved.plaintext_headers(),
        )
    if resolved.credential_mode != "env":
        return None
    api_key = next(
        (
            credential.value
            for credential in resolved.credentials
            if credential.binding.name == "OPENAI_API_KEY"
        ),
        None,
    )
    if not api_key:
        return None
    return UtilityModelRoute(
        base_url=(base_url or OPENAI_BASE_URL).rstrip("/"),
        model=resolved.model,
        headers={"Authorization": f"Bearer {api_key}"},
    )


def _internal_gateway_url(base_url: str, *, platform: PlatformConnection) -> str:
    """The gateway route on the in-network API address. A run's route names the PUBLIC
    address, because it is written into a sandbox; this process can take the shorter hop."""
    public = platform.gateway_base_url()
    internal = platform.base_url()
    if public and internal and public != internal and base_url.startswith(public):
        return internal + base_url[len(public) :]
    return base_url


def first_user_text(messages) -> Optional[str]:
    """The text of the first user message, cut for the naming call."""
    for message in messages or []:
        if getattr(message, "role", None) != "user":
            continue
        content = message.content
        if isinstance(content, str):
            text = content
        else:
            text = "\n".join(
                block.text for block in content if block.type == "text" and block.text
            )
        text = text.strip()
        return text[:MAX_MESSAGE_CHARS] if text else None
    return None


def _clean(value: Any, limit: int) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split()).strip().strip('"').strip()
    return text[:limit].rstrip() if text else None


def parse_names(content: Optional[str], *, name_agent: bool) -> Optional[ProposedNames]:
    """The names in the model's reply, or ``None`` for an empty or unreadable reply."""
    if not content:
        return None
    match = _JSON_OBJECT.search(content)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    session_name = _clean(data.get("session_name"), MAX_NAME_CHARS)
    if not session_name:
        return None
    return ProposedNames(
        session_name=session_name,
        description=_clean(data.get("description"), MAX_DESCRIPTION_CHARS),
        agent_name=(
            _clean(data.get("agent_name"), MAX_NAME_CHARS) if name_agent else None
        ),
    )


async def propose_names(
    route: UtilityModelRoute,
    message: str,
    *,
    name_agent: bool,
    client: httpx.AsyncClient,
) -> Optional[ProposedNames]:
    """One chat completion that reads the first message and returns the names."""
    prompt = _PROMPT % ((_AGENT_FIELD, _AGENT_RULE) if name_agent else ("", ""))
    # `max_completion_tokens`, not `max_tokens`: OpenAI's reasoning models refuse the older
    # field. No `temperature` either, for the same reason.
    body: Dict[str, Any] = {
        "model": route.model,
        "max_completion_tokens": MAX_OUTPUT_TOKENS,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": message},
        ],
    }
    # Gemini thinks by default, and thinking would spend the output budget. Other families
    # differ in which value they accept, so they get no setting.
    if "gemini" in route.model.lower():
        body["reasoning_effort"] = "minimal"
    url = f"{route.base_url}/chat/completions"
    response = await client.post(url, headers=route.headers, json=body)
    if response.status_code == 400 and body.pop("reasoning_effort", None):
        log.warning("agent naming: the endpoint refused reasoning_effort; retrying")
        response = await client.post(url, headers=route.headers, json=body)
    if response.status_code >= 400:
        log.warning("agent naming: model call HTTP %s", response.status_code)
        return None
    try:
        content = response.json()["choices"][0]["message"].get("content")
    except (ValueError, KeyError, IndexError, TypeError, AttributeError):
        log.warning("agent naming: model call returned an unreadable body")
        return None
    return parse_names(content, name_agent=name_agent)


async def write_names(
    names: ProposedNames,
    *,
    session_id: str,
    workflow_id: Optional[str],
    platform: PlatformConnection,
    headers: Dict[str, str],
    client: httpx.AsyncClient,
) -> None:
    """Store the names with the rename tools' endpoints. ``automatic`` lets a name a person
    typed win over this one."""
    api_base = platform.base_url()
    if not api_base:
        return
    header: Dict[str, Any] = {"name": names.session_name}
    if names.description:
        header["description"] = names.description
    response = await client.post(
        f"{api_base}/sessions/streams/header",
        params={"session_id": session_id, "name_source": "automatic"},
        headers=headers,
        json=header,
    )
    if response.status_code >= 400:
        log.warning("agent naming: session name write HTTP %s", response.status_code)
    if names.agent_name and workflow_id:
        response = await client.put(
            f"{api_base}/workflows/{quote(workflow_id, safe='')}",
            headers=headers,
            json={"workflow": {"id": workflow_id, "name": names.agent_name}},
        )
        if response.status_code >= 400:
            log.warning("agent naming: agent name write HTTP %s", response.status_code)


ResolveConnectionFn = Callable[..., Awaitable[ResolvedConnection]]


class SessionNaming:
    """One naming call for one first turn. The handler starts it and tells it when the
    runner's first frame arrives. The writes wait for that frame, because the runner creates
    the session row, with its owner, on its first heartbeat. A turn that ends with no frame
    writes nothing."""

    _running: "set[asyncio.Task]" = set()

    def __init__(self) -> None:
        self._settled = asyncio.Event()
        self._runner_started = False

    def runner_started(self) -> None:
        self._runner_started = True
        self._settled.set()

    def turn_ended(self) -> None:
        self._settled.set()

    def start(self, work: Awaitable[None]) -> None:
        # Held here: a task with no strong reference can be collected before it finishes.
        task = asyncio.ensure_future(work)
        SessionNaming._running.add(task)
        task.add_done_callback(SessionNaming._running.discard)

    async def wait_for_runner(self) -> bool:
        await asyncio.wait_for(self._settled.wait(), timeout=RUNNER_WAIT_SECONDS)
        return self._runner_started


def start_session_naming(
    *,
    messages,
    session_id: Optional[str],
    workflow_id: Optional[str],
    name_agent: bool,
    resolved_connection: Optional[ResolvedConnection],
    resolve_connection: ResolveConnectionFn,
) -> Optional[SessionNaming]:
    """Start the naming call for this first turn, or return ``None`` when none applies.

    The caller has already decided that this is the first turn of an unnamed session. The
    platform credential is read here, in the request's context, because the task outlives the
    request handler on the streaming path.
    """
    if not session_id:
        return None
    message = first_user_text(messages)
    if not message:
        return None
    platform = PlatformConnection()
    headers = platform.headers()
    if not platform.base_url() or "Authorization" not in headers:
        return None

    route = configured_route()
    model = None if route else builtin_model()
    if route is None and model is None:
        route = route_from_connection(resolved_connection, platform=platform)
        if route is None:
            return None

    naming = SessionNaming()

    async def _builtin_route() -> Optional[UtilityModelRoute]:
        resolved = await resolve_connection(
            model=ModelRef(
                provider="openai",
                model=model,
                connection=Connection(
                    mode="agenta", slug=BUILTIN_PROVIDER_SLUG, namespace="builtin"
                ),
            ),
            context=RuntimeAuthContext(session_id=session_id, agent_id=workflow_id),
        )
        return route_from_connection(resolved, platform=platform)

    async def _propose(client: httpx.AsyncClient) -> Optional[ProposedNames]:
        target = route or await _builtin_route()
        if target is None:
            log.warning("agent naming: the built-in model gave no OpenAI route")
            return None
        return await propose_names(
            target, message, name_agent=name_agent, client=client
        )

    async def _work() -> None:
        try:
            async with httpx.AsyncClient(timeout=NAMING_TIMEOUT_SECONDS) as client:
                names = await asyncio.wait_for(
                    _propose(client), timeout=NAMING_TIMEOUT_SECONDS
                )
                if names is None or not await naming.wait_for_runner():
                    return
                await write_names(
                    names,
                    session_id=session_id,
                    workflow_id=workflow_id,
                    platform=platform,
                    headers=headers,
                    client=client,
                )
        except asyncio.TimeoutError:
            log.warning("agent naming: timed out")
        except Exception:  # pylint: disable=broad-except
            log.warning("agent naming: failed", exc_info=True)

    naming.start(_work())
    return naming
