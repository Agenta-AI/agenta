"""Circuit breaker for webhook subscriptions to prevent cascading failures."""

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, List
from enum import Enum

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class CircuitState(str, Enum):
    """Circuit breaker states."""

    CLOSED = "closed"  # Normal operation, track failures
    OPEN = "open"  # Too many failures, reject requests for cooldown period
    HALF_OPEN = "half_open"  # After cooldown, allow one test request


class CircuitBreaker:
    """
    Circuit breaker per webhook subscription to prevent cascading failures.

    States:
    - CLOSED: Normal operation, tracks failures
    - OPEN: Too many failures (threshold exceeded), rejects for cooldown period
    - HALF_OPEN: After cooldown, allows one test request to check recovery

    Thresholds (configurable):
    - failure_threshold: Number of failures before opening (default: 5)
    - failure_window: Time window for counting failures in seconds (default: 60s)
    - cooldown_period: Time circuit stays open in seconds (default: 300s = 5min)

    Example:
        After 5 failures within 60 seconds:
        1. Circuit opens → All requests rejected for 5 minutes
        2. After 5 minutes → Circuit moves to HALF_OPEN
        3. Next request is allowed as a test
        4. If test succeeds → Circuit closes, normal operation resumes
        5. If test fails → Circuit reopens for another 5 minutes
    """

    def __init__(
        self,
        failure_threshold: int = 5,
        failure_window: int = 60,  # seconds
        cooldown_period: int = 300,  # 5 minutes
    ):
        """
        Initialize circuit breaker.

        Args:
            failure_threshold: Number of failures before opening circuit
            failure_window: Time window for counting failures (seconds)
            cooldown_period: How long circuit stays open (seconds)
        """
        self.failure_threshold = failure_threshold
        self.failure_window = failure_window
        self.cooldown_period = cooldown_period

        # State per subscription_id
        self.states: Dict[str, CircuitState] = {}
        self.failure_times: Dict[str, List[datetime]] = {}  # Track failure timestamps
        self.opened_at: Dict[str, datetime] = {}  # When circuit was opened
        self.lock = asyncio.Lock()

    async def is_open(self, subscription_id: str) -> bool:
        """
        Check if circuit is open (should reject requests).

        Args:
            subscription_id: Subscription to check

        Returns:
            True if circuit is open (reject), False if closed/half-open (allow)
        """
        async with self.lock:
            state = self.states.get(subscription_id, CircuitState.CLOSED)

            if state == CircuitState.OPEN:
                # Check if cooldown period has elapsed
                opened_time = self.opened_at.get(subscription_id)
                if opened_time:
                    elapsed = (datetime.now(timezone.utc) - opened_time).total_seconds()
                    if elapsed >= self.cooldown_period:
                        # Move to HALF_OPEN for testing
                        self.states[subscription_id] = CircuitState.HALF_OPEN
                        log.info(
                            f"Circuit breaker for subscription {subscription_id} "
                            f"moved to HALF_OPEN after {elapsed:.0f}s cooldown"
                        )
                        return False  # Allow one test request
                return True  # Still in cooldown, reject

            return False  # CLOSED or HALF_OPEN, allow request

    async def record_success(self, subscription_id: str):
        """
        Record successful delivery.

        Args:
            subscription_id: Subscription that succeeded
        """
        async with self.lock:
            # Clear failure history
            self.failure_times[subscription_id] = []

            # If in HALF_OPEN, move back to CLOSED
            current_state = self.states.get(subscription_id)
            if current_state == CircuitState.HALF_OPEN:
                self.states[subscription_id] = CircuitState.CLOSED
                log.info(
                    f"Circuit breaker CLOSED for subscription {subscription_id} (recovery successful)"
                )
            elif current_state == CircuitState.OPEN:
                # Shouldn't happen, but handle gracefully
                self.states[subscription_id] = CircuitState.CLOSED
                log.info(f"Circuit breaker CLOSED for subscription {subscription_id}")

    async def record_failure(self, subscription_id: str):
        """
        Record failed delivery and potentially open circuit.

        Args:
            subscription_id: Subscription that failed
        """
        async with self.lock:
            now = datetime.now(timezone.utc)
            current_state = self.states.get(subscription_id, CircuitState.CLOSED)

            # Initialize if first failure
            if subscription_id not in self.failure_times:
                self.failure_times[subscription_id] = []

            # Add failure timestamp
            self.failure_times[subscription_id].append(now)

            # Remove old failures outside the time window
            cutoff = now - timedelta(seconds=self.failure_window)
            self.failure_times[subscription_id] = [
                t for t in self.failure_times[subscription_id] if t > cutoff
            ]

            # Count failures in window
            failure_count = len(self.failure_times[subscription_id])

            # If in HALF_OPEN and failed, reopen circuit
            if current_state == CircuitState.HALF_OPEN:
                self.states[subscription_id] = CircuitState.OPEN
                self.opened_at[subscription_id] = now
                log.warning(
                    f"Circuit breaker REOPENED for subscription {subscription_id} "
                    f"(test request failed)"
                )
                return

            # Check if threshold exceeded
            if failure_count >= self.failure_threshold:
                self.states[subscription_id] = CircuitState.OPEN
                self.opened_at[subscription_id] = now
                log.warning(
                    f"Circuit breaker OPENED for subscription {subscription_id} "
                    f"({failure_count} failures in {self.failure_window}s)"
                )

    def get_state(self, subscription_id: str) -> CircuitState:
        """
        Get current circuit state for a subscription.

        Args:
            subscription_id: Subscription to check

        Returns:
            Current circuit state
        """
        return self.states.get(subscription_id, CircuitState.CLOSED)

    def get_stats(self, subscription_id: str) -> dict:
        """
        Get circuit breaker statistics for a subscription.

        Args:
            subscription_id: Subscription to get stats for

        Returns:
            Dict with state, failure count, and opened time
        """
        state = self.states.get(subscription_id, CircuitState.CLOSED)
        failures = self.failure_times.get(subscription_id, [])
        opened_at = self.opened_at.get(subscription_id)

        return {
            "state": state.value,
            "failure_count": len(failures),
            "opened_at": opened_at.isoformat() if opened_at else None,
        }


# Global circuit breaker instance (shared across worker tasks)
circuit_breaker = CircuitBreaker(
    failure_threshold=5,  # Open after 5 failures
    failure_window=60,  # Within 60 seconds
    cooldown_period=300,  # Stay open for 5 minutes
)
