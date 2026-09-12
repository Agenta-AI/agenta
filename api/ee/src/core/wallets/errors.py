"""Wallet stream error taxonomy.

Every error is either terminal (the message itself is unusable; ACK and drop, retry cannot
help) or retryable (a transient failure while acting on an otherwise-valid message; leave
the stream entry pending for normal consumer-group redelivery).
"""


class WalletError(Exception):
    """Base class for all wallet-domain errors."""


class WalletTerminalError(WalletError):
    """Terminal: the message itself cannot be processed. ACK and drop — retrying the same
    bytes will fail identically."""


class MalformedEnvelopeError(WalletTerminalError):
    """Terminal: the stream payload failed to decompress, parse, or validate against its
    envelope model."""


class UnsupportedVersionError(WalletTerminalError):
    """Terminal: the envelope's `version` is not one this worker understands. There is no
    way to safely price or settle an envelope shape the worker cannot interpret."""

    def __init__(self, *, version, message: str = None):
        self.version = version
        super().__init__(message or f"Unsupported envelope version: {version!r}")


class WalletRetryableError(WalletError):
    """Retryable: a transient failure while acting on a valid message. The caller should
    leave the stream entry pending so normal consumer-group retry can redeliver it."""


class SettlementUnavailableError(WalletRetryableError):
    """Retryable: the settlement backend (database, distributed lock, …) was unavailable
    or timed out."""
