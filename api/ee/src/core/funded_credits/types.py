from pydantic import BaseModel


class FundedCreditsError(Exception):
    """Base exception for funded-credits errors."""


class ProxyRequestError(FundedCreditsError):
    """The proxy admin API refused or failed a request.

    Never carries key material; `detail` is a short, log-safe diagnosis.
    """

    def __init__(self, *, status_code: int | None, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"proxy request failed ({status_code}): {detail}")


class KeyAliasExistsError(ProxyRequestError):
    """A key with this alias was already minted (idempotency signal)."""


class MintedKey(BaseModel):
    key: str
    key_alias: str
