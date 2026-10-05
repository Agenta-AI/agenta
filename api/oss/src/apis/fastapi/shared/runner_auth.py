"""The shared secret that proves a request comes from the platform's runner.

A tenant credential says whose request it is; this says who is making it. Routes that only
the runner may call (session ownership release, sandbox usage reports) require both.
"""

from secrets import compare_digest

from fastapi import HTTPException, Request, status

from oss.src.utils.env import env


def assert_runner_token(request: Request) -> None:
    """The runner proves it is the platform runtime with the shared secret both sides hold.

    Constant-time compare, so a wrong token leaks no length or prefix through timing. A missing
    configured token fails closed: an unset secret must never mean "let everyone in".
    """
    expected = env.runner.token
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="runner token is not configured on this deployment",
        )
    presented = request.headers.get("X-Agenta-Runner-Token") or ""
    if not presented:
        authorization = request.headers.get("Authorization") or ""
        if authorization.lower().startswith("bearer "):
            presented = authorization[7:].strip()
    if not compare_digest(presented.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized",
        )
