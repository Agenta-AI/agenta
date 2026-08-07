from io import BytesIO
from zipfile import ZipFile

import pytest
from oss.src.core.sessions.attachments.dtos import AttachmentKind
from oss.src.core.sessions.attachments.media import classify
from oss.src.core.sessions.attachments.types import AttachmentInvalid


def test_inspected_png_type_overrides_declared_text_type():
    result = classify(
        data=b"\x89PNG\r\n\x1a\n" + (b"\x00" * 32),
        declared_media_type="text/plain",
    )

    assert result.media_type == "image/png"
    assert result.kind == AttachmentKind.IMAGE
    assert result.native_image is True


def test_unsigned_markdown_keeps_declared_text_subtype():
    result = classify(
        data=b"# Heading\n\nBody\n",
        declared_media_type="text/markdown",
    )

    assert result.media_type == "text/markdown"
    assert result.kind == AttachmentKind.DOCUMENT


def test_unsigned_csv_with_binary_declaration_becomes_plain_text():
    result = classify(
        data=b"name,value\nalpha,1\n",
        declared_media_type="application/octet-stream",
    )

    assert result.media_type == "text/plain"
    assert result.kind == AttachmentKind.DOCUMENT


@pytest.mark.parametrize("data", [b"", b"\x80\x81\x82\x83\x84"])
def test_empty_or_unrecognizable_non_utf8_bytes_are_invalid(data):
    with pytest.raises(AttachmentInvalid):
        classify(data=data, declared_media_type="application/octet-stream")


def _zip_bytes(*, files):
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        for path, content in files:
            archive.writestr(path, content)
    return buffer.getvalue()


def test_plain_zip_is_classified_as_zip():
    data = _zip_bytes(files=[("file.txt", "hello")])

    result = classify(
        data=data,
        declared_media_type="application/zip",
    )

    assert result.media_type == "application/zip"
    assert result.kind == AttachmentKind.OTHER
    assert result.native_image is False


def test_plain_zip_structure_overrides_declared_docx_type():
    result = classify(
        data=_zip_bytes(files=[("notes.txt", "hello")]),
        declared_media_type=(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
    )

    assert result.media_type == "application/zip"
    assert result.kind == AttachmentKind.OTHER


@pytest.mark.parametrize(
    "declared_media_type",
    [
        "application/zip",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
)
def test_docx_structure_is_classified_as_docx(declared_media_type):
    result = classify(
        data=_zip_bytes(
            files=[
                ("[Content_Types].xml", "<Types />"),
                ("word/document.xml", "<document />"),
            ]
        ),
        declared_media_type=declared_media_type,
    )

    assert result.media_type == (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert result.kind == AttachmentKind.OTHER


def test_malformed_zip_signature_keeps_inspected_type(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.sessions.attachments.media.puremagic.from_string",
        lambda *_args, **_kwargs: "application/zip",
    )

    result = classify(
        data=b"PK\x03\x04not-a-valid-archive",
        declared_media_type="application/zip",
    )

    assert result.media_type == "application/zip"
    assert result.kind == AttachmentKind.OTHER


def test_svg_is_a_workspace_document_not_a_native_image():
    result = classify(
        data=b'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        declared_media_type="image/svg+xml",
    )

    assert result.media_type == "image/svg+xml"
    assert result.kind == AttachmentKind.DOCUMENT
    assert result.native_image is False


_AUDIO_CORPUS = [
    (
        "wav",
        b"RIFF"
        + (36).to_bytes(4, "little")
        + b"WAVEfmt "
        + (16).to_bytes(4, "little")
        + b"\x01\x00\x01\x00\x40\x1f\x00\x00\x80\x3e\x00\x00\x02\x00\x10\x00"
        + b"data\x00\x00\x00\x00",
        None,
    ),
    (
        "mp3",
        b"ID3\x04\x00\x00\x00\x00\x00\x00\xff\xfb\x90\x64" + (b"\x00" * 32),
        None,
    ),
    (
        "ogg",
        b"OggS" + (b"\x00" * 24) + b"\x01vorbis" + (b"\x00" * 32),
        "audio/ogg",
    ),
    (
        "webm",
        b"\x1aE\xdf\xa3" + (b"\x00" * 16) + b"webm" + b"A_OPUS",
        "audio/webm",
    ),
    (
        "flac",
        b"fLaC\x00\x00\x00\x22" + (b"\x00" * 34),
        None,
    ),
    (
        "m4a",
        (24).to_bytes(4, "big")
        + b"ftyp"
        + b"M4A "
        + b"\x00\x00\x00\x00"
        + b"M4A "
        + b"isom",
        "audio/mp4",
    ),
]


@pytest.mark.parametrize(("_name", "data", "expected_media_type"), _AUDIO_CORPUS)
def test_audio_container_corpus_is_classified_as_audio(
    _name,
    data,
    expected_media_type,
):
    result = classify(
        data=data,
        declared_media_type="application/octet-stream",
    )

    if expected_media_type is not None:
        assert result.media_type == expected_media_type
    else:
        assert result.media_type.startswith("audio/")
    assert result.kind == AttachmentKind.AUDIO
    assert result.native_image is False


@pytest.mark.parametrize(
    ("data", "expected_media_type"),
    [
        (
            b"OggS" + (b"\x00" * 24) + b"\x80theora" + b"\x01vorbis" + (b"\x00" * 16),
            "video/ogg",
        ),
        (
            b"\x1aE\xdf\xa3" + (b"\x00" * 16) + b"webm" + b"V_VP9" + b"A_OPUS",
            "video/webm",
        ),
    ],
)
def test_video_containers_remain_other_even_with_audio_markers(
    data,
    expected_media_type,
):
    result = classify(data=data, declared_media_type="audio/ogg")

    assert result.media_type == expected_media_type
    assert result.kind == AttachmentKind.OTHER
    assert result.native_image is False


def test_empty_puremagic_result_is_unrecognized(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.sessions.attachments.media.puremagic.from_string",
        lambda *_args, **_kwargs: "",
    )

    with pytest.raises(AttachmentInvalid):
        classify(
            data=b"\x80\x81\x82\x83\x84",
            declared_media_type="audio/mp4",
        )
