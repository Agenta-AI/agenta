import pytest

from oss.src.utils.env import SmtpConfig


def test_smtp_config_rejects_tls_and_ssl_at_the_same_time():
    with pytest.raises(
        ValueError, match="SMTP_USE_TLS and SMTP_USE_SSL cannot both be true"
    ):
        SmtpConfig(
            host="smtp.example.com",
            port=587,
            from_email="smtp@example.com",
            use_tls=True,
            use_ssl=True,
        )
