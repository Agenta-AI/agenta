import pytest

from oss.src.core.sessions.attachments.service import sanitize_attachment_filename
from oss.src.core.sessions.attachments.types import AttachmentRequestInvalid


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("../../etc/passwd", "passwd"),
        (r"..\..\etc\passwd", "passwd"),
        ("..", "attachment"),
        ("", "attachment"),
        (None, "attachment"),
    ],
)
def test_filename_is_reduced_to_a_safe_basename(filename, expected):
    assert sanitize_attachment_filename(filename) == expected


@pytest.mark.parametrize(
    "filename",
    [
        "bad\x00name.txt",
        "bad\nname.txt",
    ],
)
def test_filename_with_control_characters_is_rejected(filename):
    with pytest.raises(AttachmentRequestInvalid):
        sanitize_attachment_filename(filename)


def test_filename_at_object_key_boundary_is_unchanged():
    filename = f"{'a' * 196}.txt"

    assert sanitize_attachment_filename(filename) == filename


def test_filename_over_object_key_boundary_preserves_extension():
    filename = f"{'a' * 197}.txt"

    sanitized = sanitize_attachment_filename(filename)

    assert len(sanitized) == 200
    assert sanitized.endswith(".txt")
