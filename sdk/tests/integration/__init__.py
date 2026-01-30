"""
Integration tests for the Agenta SDK.

These tests make REAL API calls to validate the SDK managers work correctly
with the Agenta backend API.

Run with: pytest sdk/tests/integration/ -v -m integration

Environment variables:
- AGENTA_HOST: API host URL (default: https://cloud.agenta.ai)
- AGENTA_API_KEY: API key for authentication (required)
"""
