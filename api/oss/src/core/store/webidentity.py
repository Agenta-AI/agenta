"""Web-identity tokens for the SeaweedFS store STS path.

ONLY FOR SEAWEEDFS (the bundled dev store). SeaweedFS's OIDC IAM vends short-lived
scoped credentials only via `AssumeRoleWithWebIdentity`, which validates an RS256 JWT
against a JWKS the provider fetches — there is no HMAC/`GetFederationToken` path. So the
API acts as its own OIDC issuer: it holds an RSA private key (same trust boundary as the
store master key — never reaches the runner), mints a short-lived RS256 web-identity token
per request, and serves the public half at `/.well-known/jwks.json` for SeaweedFS to verify.

Real S3/R2/MinIO have native STS and never hit this — `storage.sign_temp_credentials` builds
the same inline session policy regardless; only this token-vending half is SeaweedFS-shaped.

The token's `sub`/`aud` pin it to the store role declared in the IAM config; the inline
session policy enforces the prefix scope. Expiry mirrors the auth secret token (15 min).
"""

from base64 import urlsafe_b64encode
from datetime import datetime, timezone, timedelta
from functools import lru_cache

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt import encode

from oss.src.utils.env import env

# The store role the IAM config trusts; the web-identity token assumes it.
STORE_AUDIENCE = "agenta-store"
STORE_SUBJECT = "agenta-store"

# Key id published in the JWKS and stamped in the token header so the store can
# select the matching key (a versioned kid can be introduced later for rotation).
_KID = "agenta-store"

_TOKEN_TTL_SECONDS = 15 * 60


def _b64u_uint(value: int) -> str:
    length = (value.bit_length() + 7) // 8
    return urlsafe_b64encode(value.to_bytes(length, "big")).rstrip(b"=").decode()


# LOCAL-DEV FALLBACK ONLY — never for production. The web-identity signing key MUST be the
# same across every API replica: SeaweedFS fetches one JWKS (from one load-balanced api:8000)
# and validates tokens minted by any replica against it, so a per-process key desyncs and fails
# validation intermittently. This constant gives every local replica the same key with zero
# config. Preview/live set AGENTA_STORE_JWT_PRIVATE_KEY (a real private RSA key) and this value
# is never used there. It is not a secret to protect — it only signs local dev store creds.
_LOCAL_DEV_PRIVATE_KEY_PEM = """-----BEGIN PRIVATE KEY-----
MIIEuwIBADANBgkqhkiG9w0BAQEFAASCBKUwggShAgEAAoIBAQCs7M4qrEmbwyS1
HrsX0AvVPBz0sNiON7N1IK7PDIoEy4u0Oo3OsGzL1KsymLOvmbO5wn588dwsS4WO
VBz0vo+vTybqbYDRSTDF3LZxoZp/KBv9QIj6Chl7k3+sYVAzKKobgWSNPAxuMKT6
OfdH1Sz9TBuiDrDw3J/yV4anuJ0MYzFxFKW6dPYlFBgivjNt/5kgximI6tKJPuxx
RW+SQcUjScL4r8VlveZiZG0HAqlMUBHnQjSl9DqDbD37q5ZvVcZh2qVXtFQshD3S
e78Hn+cWIdo2L37jto27pj1HD4er9UaW4qixQuPMJOeLicPuAQEUstsQIaiJ0zlA
kkFUUt03AgMBAAECgf8B4bZcm/EMigDJ98J/JGj8jZiefrvchyxadVwD5MObt3a7
bQxCjvIN2Au7uBI8e4H5KBJc2/vANn/iHuOffQWlh0lAjPB+exaMx36idMRL5xGL
eRYEffMSLlHZ6cd1onulGh7HIYS392HUMqi1DRzLpNGDloDEHjTD7lR2fsKkciId
E5Y8zz4LSeeVw7dAX1EN2kh8ZyarhJK38YoTyvTkSL7B8uQr4+7sbZJcBIa1ywED
1EhYyB9VMHTXGHhLaATiMoEJZ6V6ppOqAA5Vik70v4UPfOxUYrBwrTaGXs2UeMOE
59bfqjKiBnkLFWbZbaVEp15MiO5P/dKH03j4VPUCgYEA8Qyn+pXpyXA4WI8pRigE
tOvjwdD/0IK6dPt325Lo1oA2NMVRUHvsXT5Ioeo6eNTuDndnvuebKiqDHnHzN5Lx
ip2+4OUyX5sqWH8Oz1X3iRpY/vtmTr5xZ/GpkAiss9DbMzt/T1AJrcHRI8fJ4d+O
DBM6hXvQsgkvBDKIFb+68KsCgYEAt6Z7EZCGdTvZ5XBYdabngfDQij3Kua7KBda8
cUNIr7rmJ+Z4KDj12+IVqiGx4HROVrpCZZENIBTiPaXDQZJuy8p7bUzt19iCtLVf
Rx73Kc80GsPrgowvuRf1KyMJnVjTGsH6MpVaBvxkTd9ieKFZKyeZvGIhlPDMU9kD
UgJ3PaUCgYBVBa3KSU5o6tg1BGn+gOcIGZwAJQPWPAYgdQJVxH+0CQ0Vl/OSe+Nn
ECz2T3PIYvKEz8EcKP0l5lDRUEgFdiMUTYeiM7WM22IYTNigcSYaidySM4Jmi+3c
R/UTBLxFwIlQjM/e3dBMJWzrPfELZprnz3B43K9D3NFknZ46baI2eQKBgQCYOGyP
rXxVVauRCmK3+gSv5pvjyb3r1F3tIwUE2GE6Dy9P6S61IClg/O86Gj2mrqB0MGRy
bR009zpjIK9L/YTKc+WEPhxyKSqFgEQd3iO9ytoESVo+1dWElMAI5jzE5+fqqNep
77M0USUOitbC5/HR3DwIMkpleoXSBfFDm3mcZQKBgFElA0qBXmsqFBr4MlrNSeIX
WbTqgeV3L0rOrcWqZ2nKDy0nlPeeUwHTChImj/VCs7l/b7dSuHyJ+G6W71giregI
x9ynTUjATZJkc4QQqTGFXyW2os6XNmYfLsKj3+X9UW7O8yp/HsN6cb5tOkFEzwSx
0ovFkz1uTHyFmoDG8e1Q
-----END PRIVATE KEY-----"""


@lru_cache(maxsize=1)
def _private_key() -> rsa.RSAPrivateKey:
    """The RSA key signing web-identity tokens.

    Preview/live set `AGENTA_STORE_JWT_PRIVATE_KEY` (PEM), shared across replicas. With it
    unset (local dev only) the local-dev fallback key is used — same across replicas, never
    ephemeral, so SeaweedFS's one cached JWKS validates tokens from every API process.
    """
    pem = env.store.jwt_private_key or _LOCAL_DEV_PRIVATE_KEY_PEM
    return serialization.load_pem_private_key(pem.encode(), password=None)


def role_arn() -> str:
    """ARN of the store role the IAM config declares; assumed via the web-identity token."""
    return f"arn:aws:iam::role/{STORE_SUBJECT}"


def issuer() -> str:
    """The `iss` claim and OIDC issuer the store IAM config is configured with.

    Must be the in-network URL the store uses to reach this API's JWKS.
    """
    return env.store.jwt_issuer


def mint_web_identity_token(*, ttl_seconds: int = _TOKEN_TTL_SECONDS) -> str:
    """A short-lived RS256 JWT the store accepts for AssumeRoleWithWebIdentity."""
    now = datetime.now(timezone.utc)
    claims = {
        "iss": issuer(),
        "sub": STORE_SUBJECT,
        "aud": STORE_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl_seconds)).timestamp()),
    }
    return encode(
        payload=claims,
        key=_private_key(),
        algorithm="RS256",
        headers={"kid": _KID},
    )


def jwks() -> dict:
    """Public JWKS for `/.well-known/jwks.json` — the store fetches this to verify."""
    numbers = _private_key().public_key().public_numbers()
    return {
        "keys": [
            {
                "kty": "RSA",
                "use": "sig",
                "alg": "RS256",
                "kid": _KID,
                "n": _b64u_uint(numbers.n),
                "e": _b64u_uint(numbers.e),
            }
        ]
    }
