import pytest

from oss.src.core.sessions.attachments.service import sanitize_attachment_filename
from oss.src.core.sessions.attachments.types import AttachmentInvalid


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
    with pytest.raises(AttachmentInvalid):
        sanitize_attachment_filename(filename)
