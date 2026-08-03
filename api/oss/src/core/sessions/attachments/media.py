from typing import Optional

import puremagic
from puremagic.main import PureError

from oss.src.core.sessions.attachments.dtos import AttachmentKind, AttachmentMedia
from oss.src.core.sessions.attachments.types import AttachmentInvalid


_NATIVE_IMAGE_TYPES = {
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
}
_M4A_BRANDS = {
    b"M4A ",
    b"M4B ",
    b"M4P ",
}
_OGG_AUDIO_CODECS = (
    b"OpusHead",
    b"Speex   ",
    b"\x01vorbis",
    b"\x7fFLAC",
)
_OGG_VIDEO_CODECS = (
    b"\x80theora",
    b"\x01video",
)
_WEBM_AUDIO_CODECS = (
    b"A_AAC",
    b"A_FLAC",
    b"A_MPEG/L3",
    b"A_OPUS",
    b"A_VORBIS",
)
_WEBM_VIDEO_CODECS = (
    b"V_AV1",
    b"V_MPEG4/ISO/AVC",
    b"V_MPEGH/ISO/HEVC",
    b"V_VP8",
    b"V_VP9",
)
_CONTAINER_SCAN_BYTES = 1024 * 1024


def _sniff(data: bytes) -> Optional[str]:
    """The only puremagic call; classification is policy, not a security boundary."""
    try:
        media_type = puremagic.from_string(data, mime=True)
        return media_type or None
    except (PureError, ValueError):
        return None


def _contains_any(*, data: bytes, signatures: tuple[bytes, ...]) -> bool:
    return any(signature in data for signature in signatures)


def _is_m4a(*, data: bytes) -> bool:
    if len(data) < 16 or data[4:8] != b"ftyp":
        return False

    box_size = int.from_bytes(data[:4], byteorder="big")
    if box_size != 0 and box_size < 16:
        return False
    box_end = min(len(data), box_size or len(data), 256)
    brands = [data[8:12]]
    brands.extend(data[offset : offset + 4] for offset in range(16, box_end, 4))
    return any(brand in _M4A_BRANDS for brand in brands)


def _canonical_container_media_type(
    *,
    data: bytes,
    inspected_media_type: Optional[str],
) -> Optional[str]:
    if _is_m4a(data=data):
        return "audio/mp4"

    scan = data[:_CONTAINER_SCAN_BYTES]
    if scan.startswith(b"OggS"):
        if _contains_any(data=scan, signatures=_OGG_VIDEO_CODECS):
            return "video/ogg"
        if _contains_any(data=scan, signatures=_OGG_AUDIO_CODECS):
            return "audio/ogg"

    if scan.startswith(b"\x1aE\xdf\xa3") and b"webm" in scan:
        if _contains_any(data=scan, signatures=_WEBM_VIDEO_CODECS):
            return "video/webm"
        if _contains_any(data=scan, signatures=_WEBM_AUDIO_CODECS):
            return "audio/webm"

    return inspected_media_type


def _kind_for(*, media_type: str) -> AttachmentKind:
    if media_type in _NATIVE_IMAGE_TYPES:
        return AttachmentKind.IMAGE
    if media_type.startswith("audio/"):
        return AttachmentKind.AUDIO
    if media_type.startswith("text/") or media_type in {
        "application/json",
        "application/pdf",
        "image/svg+xml",
    }:
        return AttachmentKind.DOCUMENT
    return AttachmentKind.OTHER


def classify(
    *, data: bytes, declared_media_type: Optional[str] = None
) -> AttachmentMedia:
    if not data:
        raise AttachmentInvalid()

    inspected_media_type = _canonical_container_media_type(
        data=data,
        inspected_media_type=_sniff(data),
    )
    if inspected_media_type is None:
        try:
            data.decode("utf-8")
        except UnicodeDecodeError as e:
            raise AttachmentInvalid() from e

        if declared_media_type and (
            declared_media_type.startswith("text/")
            or declared_media_type == "application/json"
        ):
            inspected_media_type = declared_media_type
        else:
            inspected_media_type = "text/plain"

    kind = _kind_for(media_type=inspected_media_type)
    return AttachmentMedia(
        media_type=inspected_media_type,
        kind=kind,
        native_image=inspected_media_type in _NATIVE_IMAGE_TYPES,
    )
