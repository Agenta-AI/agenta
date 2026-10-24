import pytest

from oss.src.core.auth.emails import normalize_email


@pytest.mark.parametrize(
    "variant",
    [
        "user@gmail.com",
        "us.er@gmail.com",
        "u.s.e.r@gmail.com",
        "user+promo@gmail.com",
        "U.s.e.r+promo@GoogleMail.com",
        "  user@googlemail.com  ",
    ],
)
def test_normalize_email_folds_gmail_variants(variant):
    assert normalize_email(variant) == "user@gmail.com"


def test_normalize_email_keeps_dots_outside_gmail():
    assert normalize_email("First.Last+tag@acme.test") == "first.last@acme.test"
    assert normalize_email("firstlast@acme.test") != normalize_email(
        "first.last@acme.test"
    )


def test_normalize_email_only_lowercases_a_malformed_address():
    assert normalize_email(" No.At.Sign ") == "no.at.sign"
    assert normalize_email("a@b@gmail.com") == "a@b@gmail.com"
