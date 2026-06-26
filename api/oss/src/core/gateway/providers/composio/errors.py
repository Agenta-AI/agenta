import httpx


def composio_error_detail(e: httpx.HTTPError) -> str:
    """Best-effort human-readable detail from a Composio HTTP error.

    Composio returns ``{"error": {"message": ...}}`` on 4xx; surface that so the
    real cause (e.g. mutually-exclusive fields) reaches the client instead of a
    bare ``400 Bad Request``.
    """
    response = getattr(e, "response", None)
    if response is not None:
        try:
            body = response.json()
            err = body.get("error") if isinstance(body, dict) else None
            if isinstance(err, dict) and err.get("message"):
                return str(err["message"])
            if response.text:
                return response.text
        except Exception:
            if response.text:
                return response.text
    return str(e)
