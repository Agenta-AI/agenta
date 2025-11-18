import pytest


class TestAuthentication:
    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.security
    async def test_api_authentication_missing_token(self, http_client):
        # ARRANGE: prepare data
        expected_status = 401
        description = "Missing token"
        headers = {}

        # ACT: send request
        response = await http_client.get("apps", headers=headers)

        # ASSERT: verify response
        assert response.status_code == expected_status, (
            f"Failed for case: {description}"
        )

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.security
    async def test_api_authentication_unsupported_token(self, http_client):
        # ARRANGE: prepare data
        token = "ak-xxxxxxxxxx"
        expected_status = 401
        description = "Unsupported token"
        headers = {"Authorization": token}

        # ACT: send request
        response = await http_client.get("apps", headers=headers)

        # ASSERT: verify response
        assert response.status_code == expected_status, (
            f"Failed for case: {description}"
        )

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.security
    async def test_api_authentication_invalid_token(self, http_client):
        # ARRANGE: prepare data
        token = "agenta.invalid-token"
        expected_status = 401
        description = "Invalid token"
        headers = {"Authorization": f"ApiKey {token}"}

        # ACT: send request
        response = await http_client.get("apps", headers=headers)

        # ASSERT: verify response
        assert response.status_code == expected_status, (
            f"Failed for case: {description}"
        )
