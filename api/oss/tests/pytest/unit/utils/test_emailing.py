from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from oss.src.utils.emailing import add_contact


class _FakeResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code


class _FakeAsyncClient:
    def __init__(self, responses):
        self.responses = responses
        self.call_count = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def post(self, *args, **kwargs):
        if self.call_count < len(self.responses):
            resp = self.responses[self.call_count]
            self.call_count += 1
            return resp
        return _FakeResponse(200)


@pytest.mark.asyncio
async def test_add_contact_success():
    loops_config = MagicMock()
    loops_config.enabled = True
    loops_config.api_key = "test-api-key"

    fake_client = _FakeAsyncClient([_FakeResponse(200)])
    with (
        patch("oss.src.utils.emailing.env.loops", loops_config),
        patch("oss.src.utils.emailing.httpx.AsyncClient", return_value=fake_client),
    ):
        response = await add_contact("test@example.com")
        assert response is not None
        assert response.status_code == 200
        assert fake_client.call_count == 1


@pytest.mark.asyncio
async def test_add_contact_retries_on_429_then_succeeds():
    loops_config = MagicMock()
    loops_config.enabled = True
    loops_config.api_key = "test-api-key"

    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(429),
            _FakeResponse(429),
            _FakeResponse(200),
        ]
    )
    with (
        patch("oss.src.utils.emailing.env.loops", loops_config),
        patch("oss.src.utils.emailing.httpx.AsyncClient", return_value=fake_client),
        patch(
            "oss.src.utils.emailing.asyncio.sleep", new_callable=AsyncMock
        ) as mock_sleep,
    ):
        response = await add_contact("test@example.com", max_retries=5, initial_delay=1)

        assert response is not None
        assert response.status_code == 200
        assert fake_client.call_count == 3
        assert mock_sleep.call_count == 2
        # First sleep delay is 1, second is 2
        mock_sleep.assert_any_call(1)
        mock_sleep.assert_any_call(2)


@pytest.mark.asyncio
async def test_add_contact_exhausts_retries():
    loops_config = MagicMock()
    loops_config.enabled = True
    loops_config.api_key = "test-api-key"

    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(429),
            _FakeResponse(429),
            _FakeResponse(429),
        ]
    )
    with (
        patch("oss.src.utils.emailing.env.loops", loops_config),
        patch("oss.src.utils.emailing.httpx.AsyncClient", return_value=fake_client),
        patch(
            "oss.src.utils.emailing.asyncio.sleep", new_callable=AsyncMock
        ) as mock_sleep,
    ):
        with pytest.raises(ConnectionError, match="Max retries reached"):
            await add_contact("test@example.com", max_retries=3, initial_delay=1)

        assert fake_client.call_count == 3
        assert mock_sleep.call_count == 3
        # Delays should be 1, 2, 4
        mock_sleep.assert_any_call(1)
        mock_sleep.assert_any_call(2)
        mock_sleep.assert_any_call(4)
