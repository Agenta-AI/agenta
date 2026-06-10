from unittest.mock import Mock

import pytest

from oss.src.services import email_service
from oss.src.utils.env import env


def _disable_smtp(monkeypatch):
    monkeypatch.setattr(env.smtp, "host", None)
    monkeypatch.setattr(env.smtp, "port", None)
    monkeypatch.setattr(env.smtp, "from_email", None)
    monkeypatch.setattr(env.smtp, "username", None)
    monkeypatch.setattr(env.smtp, "password", None)
    monkeypatch.setattr(env.smtp, "use_tls", True)
    monkeypatch.setattr(env.smtp, "use_ssl", False)


def _disable_sendgrid(monkeypatch):
    monkeypatch.setattr(env.sendgrid, "api_key", None)
    monkeypatch.setattr(env.sendgrid, "from_address", None)


def _enable_smtp(monkeypatch, *, use_tls=True, use_ssl=False, username="user"):
    monkeypatch.setattr(env.smtp, "host", "smtp.example.com")
    monkeypatch.setattr(env.smtp, "port", 587)
    monkeypatch.setattr(env.smtp, "from_email", "smtp@example.com")
    monkeypatch.setattr(env.smtp, "username", username)
    monkeypatch.setattr(env.smtp, "password", "secret")
    monkeypatch.setattr(env.smtp, "use_tls", use_tls)
    monkeypatch.setattr(env.smtp, "use_ssl", use_ssl)


class FakeSmtp:
    instances = []

    def __init__(self, host, port, **kwargs):
        self.host = host
        self.port = port
        self.kwargs = kwargs
        self.starttls = Mock()
        self.login = Mock()
        self.send_message = Mock()
        FakeSmtp.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


@pytest.mark.asyncio
async def test_send_email_uses_smtp_with_starttls(monkeypatch):
    _enable_smtp(monkeypatch, use_tls=True, use_ssl=False)
    _disable_sendgrid(monkeypatch)
    FakeSmtp.instances = []
    monkeypatch.setattr(email_service.smtplib, "SMTP", FakeSmtp)

    assert await email_service.send_email(
        to_email="to@example.com",
        subject="Subject",
        html_content="<p>Hello</p>",
        from_email="caller@example.com",
    )

    smtp = FakeSmtp.instances[0]
    assert smtp.host == "smtp.example.com"
    assert smtp.port == 587
    smtp.starttls.assert_called_once()
    smtp.login.assert_called_once_with("user", "secret")
    message = smtp.send_message.call_args.args[0]
    assert message["From"] == "caller@example.com"
    assert message["To"] == "to@example.com"
    assert message["Subject"] == "Subject"


@pytest.mark.asyncio
async def test_send_email_prefers_smtp_over_sendgrid(monkeypatch):
    _enable_smtp(monkeypatch, use_tls=False, use_ssl=False)
    monkeypatch.setattr(env.sendgrid, "api_key", "sg-key")
    monkeypatch.setattr(env.sendgrid, "from_address", "sendgrid@example.com")
    sendgrid_client = Mock()
    monkeypatch.setattr(email_service.sendgrid, "SendGridAPIClient", sendgrid_client)
    FakeSmtp.instances = []
    monkeypatch.setattr(email_service.smtplib, "SMTP", FakeSmtp)

    assert await email_service.send_email(
        to_email="to@example.com",
        subject="Subject",
        html_content="<p>Hello</p>",
        from_email="caller@example.com",
    )

    assert FakeSmtp.instances
    sendgrid_client.assert_not_called()


@pytest.mark.asyncio
async def test_send_email_uses_smtp_ssl_without_starttls(monkeypatch):
    _enable_smtp(monkeypatch, use_tls=True, use_ssl=True)
    _disable_sendgrid(monkeypatch)
    FakeSmtp.instances = []
    monkeypatch.setattr(email_service.smtplib, "SMTP_SSL", FakeSmtp)

    assert await email_service.send_email(
        to_email="to@example.com",
        subject="Subject",
        html_content="<p>Hello</p>",
        from_email="caller@example.com",
    )

    smtp = FakeSmtp.instances[0]
    assert "context" in smtp.kwargs
    smtp.starttls.assert_not_called()
    smtp.login.assert_called_once_with("user", "secret")
    smtp.send_message.assert_called_once()


@pytest.mark.parametrize("missing_credential", ["username", "password"])
def test_send_smtp_email_requires_username_and_password(
    monkeypatch, missing_credential
):
    _enable_smtp(monkeypatch)
    monkeypatch.setattr(env.smtp, missing_credential, None)
    FakeSmtp.instances = []
    monkeypatch.setattr(email_service.smtplib, "SMTP", FakeSmtp)

    with pytest.raises(
        RuntimeError,
        match="SMTP_USERNAME and SMTP_PASSWORD must be configured together",
    ):
        email_service._send_smtp_email_sync(
            to_email="to@example.com",
            subject="Subject",
            html_content="<p>Hello</p>",
            from_email="caller@example.com",
        )

    assert not FakeSmtp.instances


@pytest.mark.asyncio
async def test_send_email_falls_back_to_sendgrid(monkeypatch):
    _disable_smtp(monkeypatch)
    monkeypatch.setattr(env.sendgrid, "api_key", "sg-key")
    monkeypatch.setattr(env.sendgrid, "from_address", "sendgrid@example.com")
    fake_sendgrid = Mock()
    sendgrid_client = Mock(return_value=fake_sendgrid)
    monkeypatch.setattr(email_service.sendgrid, "SendGridAPIClient", sendgrid_client)

    assert await email_service.send_email(
        to_email="to@example.com",
        subject="Subject",
        html_content="<p>Hello</p>",
        from_email="caller@example.com",
    )

    sendgrid_client.assert_called_once_with(api_key="sg-key")
    fake_sendgrid.send.assert_called_once()


@pytest.mark.asyncio
async def test_send_email_noops_when_no_provider_is_configured(monkeypatch):
    _disable_smtp(monkeypatch)
    _disable_sendgrid(monkeypatch)

    assert await email_service.send_email(
        to_email="to@example.com",
        subject="Subject",
        html_content="<p>Hello</p>",
        from_email="caller@example.com",
    )


def test_auth_email_method_uses_strict_smtp_detection(monkeypatch):
    monkeypatch.setattr(env.agenta.access, "email_disabled", False)
    _disable_sendgrid(monkeypatch)
    _disable_smtp(monkeypatch)

    monkeypatch.setattr(env.smtp, "host", "smtp.example.com")
    monkeypatch.setattr(env.smtp, "port", 587)
    assert env.auth.email_method == "password"

    monkeypatch.setattr(env.smtp, "from_email", "smtp@example.com")
    assert env.auth.email_method == "otp"


def test_incomplete_smtp_does_not_enable_email_otp(monkeypatch):
    monkeypatch.setattr(env.agenta.access, "email_disabled", False)
    _disable_sendgrid(monkeypatch)
    _disable_smtp(monkeypatch)

    monkeypatch.setattr(env.smtp, "host", "smtp.example.com")
    monkeypatch.setattr(env.smtp, "from_email", "smtp@example.com")

    assert not env.smtp.enabled
    assert env.auth.email_method == "password"
