"""Wallet stream error taxonomy.

Every error is either terminal (the message itself is unusable; ACK and drop, retry cannot
help) or retryable (a transient failure while acting on an otherwise-valid message; leave
the stream entry pending for normal consumer-group redelivery).
"""


class WalletError(Exception):
    """Base class for all wallet-domain errors, stream-level and core alike."""


class WalletTerminalError(WalletError):
    """Terminal: the message itself cannot be processed. ACK and drop — retrying the same
    bytes will fail identically."""


class MalformedEnvelopeError(WalletTerminalError):
    """Terminal: the stream payload failed to decompress, parse, or validate against its
    envelope model."""


class UnsupportedVersionError(WalletTerminalError):
    """Terminal: the envelope's `version` is not one this worker understands. There is no
    way to safely price or settle an envelope shape the worker cannot interpret."""

    def __init__(self, *, version):
        self.version = version
        super().__init__(f"Unsupported envelope version: {version!r}")


class WalletRetryableError(WalletError):
    """Retryable: a transient failure while acting on a valid message. The caller should
    leave the stream entry pending so normal consumer-group retry can redeliver it."""


class SettlementUnavailableError(WalletRetryableError):
    """Retryable: the settlement backend (database, distributed lock, …) was unavailable
    or timed out."""


class UnpricedMeasurementError(WalletRetryableError):
    """Retryable: a platform-funded measurement names a resource the rate card does not
    price. An unknown price is not a zero price, so nothing is stored and the message is
    retried, which covers a worker older than the API that emitted it, and dead-lettered
    if the card never learns the price."""

    def __init__(self, *, resource_key: str):
        self.resource_key = resource_key
        super().__init__(f"No rate for {resource_key!r}")


class MeasurementConflictError(WalletTerminalError):
    """Terminal: a measurement id arrived again with different content from the stored
    measurement. The stored fact stays as it is and the new payload is not charged."""

    def __init__(self, *, measurement_id: str):
        self.measurement_id = measurement_id
        super().__init__(
            f"Measurement {measurement_id!r} replayed with a different payload"
        )


class OrganizationNotResolvedError(WalletTerminalError):
    """Terminal: a chargeable measurement's project resolves to no organization, so there
    is no wallet to debit."""
