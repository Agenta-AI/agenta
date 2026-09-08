"""The rules that decide what a subscription login is worth.

Pure functions over a stored row and an incoming credential. They answer three questions:
is this blob a credential a run could authenticate with, does a pushed login belong on this
row, and has the row moved on since a run was given its login. The service in
`subscription_service.py` performs the hops and the writes; nothing here reads or writes.

The runner applies the same shape rules in `validateSubscriptionLogin` before it pushes.
Keep the two the same.
"""

from base64 import urlsafe_b64decode
from datetime import datetime, timezone
from enum import Enum
from json import loads as json_loads
from typing import Any, Dict, Optional

from oss.src.core.secrets.dtos import SubscriptionProviderDTO


# The claim a Codex access token carries the ChatGPT account in. Pi reads the same one.
_ACCOUNT_CLAIM = "https://api.openai.com/auth"
_ACCOUNT_CLAIM_FIELD = "chatgpt_account_id"


class PushDecision(str, Enum):
    """What a pushed login is worth against the row it claims to refresh."""

    ACCEPT = "accept"
    # The same refresh token is already stored. A second store would bump the version for
    # nothing, and on two simultaneous polls it would bump it twice.
    NOOP = "noop"
    # The run carried an older lineage. It gets the current login back.
    STALE = "stale"
    # The credential itself is not usable, whatever lineage it claims.
    INVALID = "invalid"
    REJECT = "reject"


def now_ms() -> int:
    """Now in epoch milliseconds, the unit a login's `expires` is written in."""
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def attempt_is_live(expires_at: Optional[str]) -> bool:
    """True while a stored device login attempt can still be completed.

    An unreadable or missing deadline counts as expired: a fresh attempt costs the user
    one more click, while reusing a dead one leaves them polling forever.
    """
    if not expires_at:
        return False

    try:
        deadline = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    except ValueError:
        return False

    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)

    return deadline > datetime.now(timezone.utc)


def _jwt_account_id(access: Any) -> Optional[str]:
    """The ChatGPT account a Codex access token names, or None if it names none.

    The signature is unchecked: only OpenAI can check it. What this catches is a token
    that is not a JWT at all, which is what a harness leaves behind when its refresh
    went wrong.
    """
    if not isinstance(access, str):
        return None

    segments = access.split(".")
    if len(segments) != 3:
        return None

    try:
        padded = segments[1] + "=" * (-len(segments[1]) % 4)
        payload = json_loads(urlsafe_b64decode(padded))
    except (ValueError, TypeError):
        return None

    if not isinstance(payload, dict):
        return None

    claim = payload.get(_ACCOUNT_CLAIM)
    if not isinstance(claim, dict):
        return None

    account_id = claim.get(_ACCOUNT_CLAIM_FIELD)
    if not isinstance(account_id, str) or not account_id:
        return None

    return account_id


def login_is_usable(login: Dict[str, Any]) -> bool:
    """True when a login is a credential a run could actually authenticate with.

    The ordering rules below ask only whether a login is NEWER, and one number is all it
    takes to win that, so a junk `access` with a far expiry would outrank a working login.
    The account comes from the token itself, never from what the file claims alongside it.
    A missing `accountId` is accepted, here and in the runner, because the field is
    optional in the credential shape and the claim is what names the account.
    """
    claimed = _jwt_account_id(login.get("access"))
    if claimed is None:
        return False

    account_id = login.get("accountId")
    if isinstance(account_id, str) and account_id and account_id != claimed:
        return False

    refresh = login.get("refresh")
    if not isinstance(refresh, str) or not refresh.strip():
        return False

    expires = login.get("expires")
    if isinstance(expires, bool) or not isinstance(expires, int):
        return False

    return expires > now_ms()


def classify_push(
    *,
    stored: SubscriptionProviderDTO,
    login: Dict[str, Any],
    generation: int,
) -> PushDecision:
    """Decide what a pushed login is worth, in the order the contract fixes.

    Shape first, because the ordering rules all assume a real credential. Then generation,
    because a login from an older lineage is not a competitor: the run is behind and needs
    the current one back. Then the account, so a login for another ChatGPT account can
    never take over the connection. Then the refresh token, which is what makes the store
    idempotent when two polls redeem the same device login. Expiry last: an equal expiry
    with a new refresh token is still a real refresh.
    """
    if stored.login is None:
        return PushDecision.REJECT

    if not login_is_usable(login):
        return PushDecision.INVALID

    if generation < stored.login_generation:
        return PushDecision.STALE

    if generation != stored.login_generation:
        # The run claims a lineage this row has never issued. Nothing safe to do with it.
        return PushDecision.REJECT

    if login.get("accountId") != stored.login.accountId:
        return PushDecision.REJECT

    if login.get("refresh") == stored.login.refresh:
        return PushDecision.NOOP

    expires = login.get("expires")
    if not isinstance(expires, int) or expires < (stored.login.expires or 0):
        return PushDecision.REJECT

    return PushDecision.ACCEPT


def failure_is_stale(
    *,
    stored: SubscriptionProviderDTO,
    version: int,
    generation: int,
) -> bool:
    """True when the row moved on since the run was given its login."""
    return stored.login_generation > generation or stored.login_version > version
