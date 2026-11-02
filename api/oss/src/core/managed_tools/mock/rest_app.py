"""The mock REST upstream for `mock.enrich_person`, served in process through
`httpx.ASGITransport`. It checks the platform key arrives, so credential handling is
exercised; the answer is deterministic in the email."""

from hashlib import sha256

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

MOCK_REST_BASE_URL = "http://mock-managed-rest.invalid/v1"
MOCK_REST_CREDENTIAL_HEADER = "x-api-key"
# Not a secret: the mock upstream accepts only this value, which proves the provider sent
# the key it was configured with.
MOCK_REST_CREDENTIAL = "mock-managed-platform-key"

app = FastAPI(title="agenta-mock-managed-rest")

_TITLES = ("Engineer", "Product Manager", "Head of Sales", "Designer", "CTO")


@app.post("/v1/people/enrich")
async def enrich_person(request: Request) -> JSONResponse:
    if request.headers.get(MOCK_REST_CREDENTIAL_HEADER) != MOCK_REST_CREDENTIAL:
        return JSONResponse({"error": "invalid api key"}, status_code=401)
    body = await request.json()
    email = str(body.get("email") or "")
    if body.get("reveal_phone_number"):
        return JSONResponse({"error": "phone reveal is not enabled"}, status_code=400)
    local, _, domain = email.partition("@")
    if local == "nobody":
        return JSONResponse({"error": "no person matches"}, status_code=404)
    digest = int(sha256(email.encode()).hexdigest(), 16)
    person = {
        "name": " ".join(
            part.capitalize() for part in local.replace("_", ".").split(".")
        ),
        "title": _TITLES[digest % len(_TITLES)],
        "company": domain.split(".")[0].capitalize(),
        "linkedin_url": f"https://linkedin.example/in/{local}-{digest % 10_000:04d}",
    }
    return JSONResponse(
        {"person": person},
        headers={"x-request-id": f"mock-rest-{digest % 1_000_000:06d}"},
    )
