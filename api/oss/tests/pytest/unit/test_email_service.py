from unittest.mock import Mock

import pytest

from oss.src.utils import emailing
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
    monkeypatch.setattr(env.sendgrid, "from_email", None)


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
    monkeypatch.setattr(emailing.smtplib, "SMTP", FakeSmtp)

    assert await emailing.send_email(
        to_email="to@example.com",
        subject="Subject",
        from_email="caller@example.com",
        username="Caller",
        action="sent you a message",
        workspace="their workspace",
        call_to_action="<p>Hello</p>",
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
    monkeypatch.setattr(env.sendgrid, "from_email", "sendgrid@example.com")
    load_sendgrid = Mock()
    monkeypatch.setattr(emailing, "_load_sendgrid", load_sendgrid)
    FakeSmtp.instances = []
    monkeypatch.setattr(emailing.smtplib, "SMTP", FakeSmtp)

    assert await emailing.send_email(
        to_email="to@example.com",
        subject="Subject",
        from_email="caller@example.com",
        username="Caller",
        action="sent you a message",
        workspace="their workspace",
        call_to_action="<p>Hello</p>",
    )

    assert FakeSmtp.instances
    load_sendgrid.assert_not_called()


@pytest.mark.asyncio
async def test_send_email_uses_smtp_ssl_without_starttls(monkeypatch):
    _enable_smtp(monkeypatch, use_tls=False, use_ssl=True)
    _disable_sendgrid(monkeypatch)
    FakeSmtp.instances = []
    monkeypatch.setattr(emailing.smtplib, "SMTP_SSL", FakeSmtp)

    assert await emailing.send_email(
        to_email="to@example.com",
        subject="Subject",
        from_email="caller@example.com",
        username="Caller",
        action="sent you a message",
        workspace="their workspace",
        call_to_action="<p>Hello</p>",
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
    monkeypatch.setattr(emailing.smtplib, "SMTP", FakeSmtp)

    with pytest.raises(
        RuntimeError,
        match="SMTP_USERNAME and SMTP_PASSWORD must be configured together",
    ):
        emailing._send_smtp_email_sync(
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
    monkeypatch.setattr(env.sendgrid, "from_email", "sendgrid@example.com")
    fake_sendgrid = Mock()
    monkeypatch.setattr(emailing, "_load_sendgrid", Mock(return_value=fake_sendgrid))

    assert await emailing.send_email(
        to_email="to@example.com",
        subject="Subject",
        from_email="caller@example.com",
        username="Caller",
        action="sent you a message",
        workspace="their workspace",
        call_to_action="<p>Hello</p>",
    )
    assert await emailing.send_email(
        to_email="to@example.com",
        subject="Subject",
        from_email="caller@example.com",
        username="Caller",
        action="sent you another message",
        workspace="their workspace",
        call_to_action="<p>Hello again</p>",
    )

    assert fake_sendgrid.send.call_count == 2


@pytest.mark.asyncio
async def test_send_email_noops_when_no_provider_is_configured(monkeypatch):
    _disable_smtp(monkeypatch)
    _disable_sendgrid(monkeypatch)
    monkeypatch.setattr(emailing, "_load_sendgrid", Mock(return_value=None))

    assert await emailing.send_email(
        to_email="to@example.com",
        subject="Subject",
        from_email="caller@example.com",
        username="Caller",
        action="sent you a message",
        workspace="their workspace",
        call_to_action="<p>Hello</p>",
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


def test_get_sender_email_prefers_smtp(monkeypatch):
    _enable_smtp(monkeypatch)
    monkeypatch.setattr(env.sendgrid, "api_key", "sg-key")
    monkeypatch.setattr(env.sendgrid, "from_email", "sendgrid@example.com")

    assert emailing._get_sender_email() == "smtp@example.com"


def test_get_sender_email_raises_when_unset(monkeypatch):
    _disable_smtp(monkeypatch)
    _disable_sendgrid(monkeypatch)

    with pytest.raises(
        ValueError,
        match=(
            "Email delivery requires a sender email address\\. "
            "Set SMTP_FROM_EMAIL, AGENTA_AUTHN_EMAIL_FROM, or "
            "AGENTA_SEND_EMAIL_FROM_ADDRESS for SMTP delivery, or "
            "SENDGRID_FROM_EMAIL \\(or legacy SENDGRID_FROM_ADDRESS\\) for SendGrid fallback\\."
        ),
    ):
        emailing._get_sender_email()
