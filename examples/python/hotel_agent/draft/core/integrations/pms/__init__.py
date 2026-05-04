"""PMS integration layer.

Six small Protocols, aggregated into PMSClient. The fake (fake.py) implements
them against SQLite; a real Mews/Cloudbeds adapter would slot in alongside.
"""

from core.integrations.pms.protocol import (
    AvailabilityAPI,
    GuestsAPI,
    InventoryAPI,
    PMSClient,
    PMSError,
    RatesAPI,
    ReservationNotFoundError,
    ReservationsAPI,
    ServicesAPI,
)

__all__ = [
    "AvailabilityAPI",
    "GuestsAPI",
    "InventoryAPI",
    "PMSClient",
    "PMSError",
    "RatesAPI",
    "ReservationNotFoundError",
    "ReservationsAPI",
    "ServicesAPI",
]
