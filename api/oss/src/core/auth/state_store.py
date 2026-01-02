"""In-memory state store for OIDC flows. TODO: Move to Redis for production."""

from typing import Dict, Optional
from datetime import datetime, timedelta
import asyncio


class StateStore:
    """Simple in-memory state store with expiration."""

    def __init__(self):
        self._store: Dict[str, Dict] = {}
        self._expiry: Dict[str, datetime] = {}

    async def set(self, key: str, value: Dict, ttl_seconds: int = 600) -> None:
        """Store a value with TTL (default 10 minutes)."""
        self._store[key] = value
        self._expiry[key] = datetime.utcnow() + timedelta(seconds=ttl_seconds)
        await self._cleanup_expired()

    async def get(self, key: str) -> Optional[Dict]:
        """Get a value, return None if expired or not found."""
        await self._cleanup_expired()

        if key not in self._store:
            return None

        if key in self._expiry and datetime.utcnow() > self._expiry[key]:
            del self._store[key]
            del self._expiry[key]
            return None

        return self._store[key]

    async def delete(self, key: str) -> None:
        """Delete a value."""
        self._store.pop(key, None)
        self._expiry.pop(key, None)

    async def _cleanup_expired(self) -> None:
        """Remove expired entries."""
        now = datetime.utcnow()
        expired_keys = [k for k, exp in self._expiry.items() if now > exp]
        for key in expired_keys:
            self._store.pop(key, None)
            self._expiry.pop(key, None)


# Singleton instance
state_store = StateStore()
