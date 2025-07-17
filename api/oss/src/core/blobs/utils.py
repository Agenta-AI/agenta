from uuid import UUID
from hashlib import blake2b
from json import dumps


def compute_blob_id(
    *,
    blob_data: dict,
    set_id: UUID,
) -> UUID:
    # Deterministically serialize the blob data
    json_blob_data = dumps(blob_data, sort_keys=True, separators=(",", ":"))

    # Combine with set_id
    unhashed = f"{str(set_id)}{json_blob_data}".encode("utf-8")

    # Blake2b with 16-byte digest
    hashed = bytearray(blake2b(unhashed, digest_size=16).digest())

    # Force version 5 (set the version bits: 0101)
    hashed[6] = (hashed[6] & 0x0F) | 0x50

    # Force variant RFC 4122 (bits 10xx)
    hashed[8] = (hashed[8] & 0x3F) | 0x80

    return UUID(bytes=bytes(hashed))
