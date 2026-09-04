import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_cache_deny_not_written_when_user_id_is_none():
    """Verify that set_cache deny entries are not written when user_id is None.

    When user_id is None (anonymous requests), writing a deny entry to the cache
    produces a generic key shared by all anonymous users. One user's auth failure
    must not deny all other anonymous users for the cache TTL.
    """
    from oss.src.middlewares.auth import verify_bearer_token

    mock_request = MagicMock()
    mock_request.url.path = "/test"
    mock_request.method = "GET"
    mock_request.headers = {}

    mock_session = AsyncMock()
    mock_session.get_user_id.return_value = None

    set_cache_calls = []

    async def capture_set_cache(**kwargs):
        set_cache_calls.append(kwargs)
        return True

    with patch("oss.src.middlewares.auth.get_session", return_value=mock_session), \
         patch("oss.src.middlewares.auth.set_cache", side_effect=capture_set_cache), \
         pytest.raises(Exception):
        await verify_bearer_token(
            request=mock_request,
            bearer_token="",
            query_project_id="test-project-id",
            query_workspace_id="test-workspace-id",
        )

    # set_cache should NOT have been called with a deny value when user_id is None
    deny_calls = [c for c in set_cache_calls if c.get("value") == {"deny": True}]
    assert len(deny_calls) == 0, (
        f"set_cache was called with deny value {len(deny_calls)} time(s) "
        f"when user_id is None. This would pollute the shared anonymous cache."
    )


@pytest.mark.asyncio
async def test_cache_deny_written_when_user_id_is_set():
    """Verify that set_cache deny entries ARE written when user_id is set.

    When user_id is known, caching the deny is correct — it prevents repeated
    failing lookups for the same specific user.
    """
    from oss.src.middlewares.auth import verify_bearer_token

    mock_request = MagicMock()
    mock_request.url.path = "/test"
    mock_request.method = "GET"
    mock_request.headers = {}

    mock_session = AsyncMock()
    mock_session.get_user_id.return_value = "user-123"

    set_cache_calls = []

    async def capture_set_cache(**kwargs):
        set_cache_calls.append(kwargs)
        return True

    # get_cache returns None (cache miss), get_supertokens_user_by_id returns
    # None (user not found), which raises UnauthorizedException. The outer
    # handler catches it and caches the deny with the now-populated user_id.
    with patch("oss.src.middlewares.auth.get_session", return_value=mock_session), \
         patch("oss.src.middlewares.auth.set_cache", side_effect=capture_set_cache), \
         patch("oss.src.middlewares.auth.get_cache", return_value=None), \
         patch("oss.src.middlewares.auth.get_supertokens_user_by_id", return_value=None), \
         pytest.raises(Exception):
        await verify_bearer_token(
            request=mock_request,
            bearer_token="",
            query_project_id="test-project-id",
            query_workspace_id="test-workspace-id",
        )

    # set_cache SHOULD have been called with a deny value when user_id is set
    deny_calls = [c for c in set_cache_calls if c.get("value") == {"deny": True}]
    assert len(deny_calls) >= 1, (
        "set_cache was not called with deny value when user_id was set. "
        "Auth failures for known users should be cached."
    )
