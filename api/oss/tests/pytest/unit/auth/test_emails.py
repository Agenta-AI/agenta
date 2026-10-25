import pytest

from oss.src.core.auth.emails import fold_gmail_variant, normalize_email


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


def test_fold_gmail_variant_folds_only_gmail():
    assert fold_gmail_variant("U.s.e.r+promo@GoogleMail.com") == "user@gmail.com"
    assert (
        fold_gmail_variant(" First.Last+tag@Acme.test ") == "first.last+tag@acme.test"
    )
    assert fold_gmail_variant("a@b@gmail.com") == "a@b@gmail.com"
