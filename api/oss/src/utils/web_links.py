"""Links into the web app, built on the server for an agent to give to a person.

Each builder returns None rather than a guess: a link an agent shares has to open.
"""

from typing import Optional
from urllib.parse import quote, urlsplit
from uuid import UUID


def web_base_url(web_url: Optional[str]) -> Optional[str]:
    """``web_url`` without its trailing slash, or None when it cannot start a link.

    It must be an http or https URL with a host, and no credentials, query or fragment.
    """
    if not web_url:
        return None
    try:
        parsed = urlsplit(web_url)
        # Parsing alone does not validate malformed or out-of-range ports.
        _ = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        return None
    return web_url.rstrip("/")


def web_path(*segments: object) -> str:
    """Path segments joined by ``/``, each one percent-encoded."""
    return "/".join(quote(str(segment), safe="") for segment in segments)


def agent_page_url(
    *,
    web_url: Optional[str],
    workspace_id: Optional[UUID],
    project_id: UUID,
    agent_id: UUID,
) -> Optional[str]:
    """The agent's page in the web app (``/m``), where the person opens a chat with it.

    ``/m`` has no separate playground route: a chat there is the playground. A person who
    turned Classic mode on is sent from this page to the agent's classic playground by the
    app's own gate (``decideMobileGate`` in ``@agenta/shared/utils/mobileGate``).
    """
    base = web_base_url(web_url)
    if base is None or workspace_id is None:
        return None
    path = web_path("m", "w", workspace_id, "p", project_id, "agents", agent_id)
    return f"{base}/{path}"
