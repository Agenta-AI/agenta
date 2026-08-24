"""Provider routes: redacted states only; secrets are write-only."""

from fastapi import APIRouter, Request

from agenta_local.core.providers.dtos import ProviderCredential

from .models import ProviderUpsert

router = APIRouter(prefix="/api/providers", tags=["providers"])


@router.get("")
async def list_providers(request: Request) -> list[dict]:
    states = await request.app.state.providers.list_states()
    return [state.model_dump(mode="json") for state in states]


@router.put("/{provider}", status_code=204)
async def put_provider(
    request: Request, provider: str, payload: ProviderUpsert
) -> None:
    api_key = payload.credentials.get("api_key")
    if not api_key:
        raise ValueError("credentials.api_key is required")
    base_url = payload.connection.get("base_url")
    await request.app.state.providers.put(
        provider=provider,
        credential=ProviderCredential(api_key=api_key, base_url=base_url),
    )


@router.delete("/{provider}", status_code=204)
async def delete_provider(request: Request, provider: str) -> None:
    await request.app.state.providers.delete(provider=provider)
