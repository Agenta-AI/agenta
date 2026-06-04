from supertokens_python.ingredients.emaildelivery.types import EmailDeliveryConfig
from supertokens_python.recipe import passwordless

from oss.src.core.auth.supertokens import config
from oss.src.utils.env import env


def _disable_smtp(monkeypatch):
    monkeypatch.setattr(env.smtp, "host", None)
    monkeypatch.setattr(env.smtp, "port", None)
    monkeypatch.setattr(env.smtp, "from_email", None)
    monkeypatch.setattr(env.smtp, "username", None)
    monkeypatch.setattr(env.smtp, "password", None)
    monkeypatch.setattr(env.smtp, "use_ssl", False)


def _enable_smtp(monkeypatch):
    monkeypatch.setattr(env.smtp, "host", "smtp.example.com")
    monkeypatch.setattr(env.smtp, "port", 1025)
    monkeypatch.setattr(env.smtp, "from_email", "smtp@example.com")
    monkeypatch.setattr(env.smtp, "username", "smtp-user")
    monkeypatch.setattr(env.smtp, "password", "smtp-secret")
    monkeypatch.setattr(env.smtp, "use_ssl", False)


def test_passwordless_email_delivery_uses_smtp_when_smtp_is_enabled(monkeypatch):
    _enable_smtp(monkeypatch)

    email_delivery = config.get_passwordless_email_delivery()

    assert isinstance(email_delivery, EmailDeliveryConfig)
    assert isinstance(email_delivery.service, passwordless.SMTPService)
    smtp_settings = email_delivery.service.transporter.smtp_settings
    assert smtp_settings.host == "smtp.example.com"
    assert smtp_settings.port == 1025
    assert smtp_settings.from_.email == "smtp@example.com"
    assert smtp_settings.username == "smtp-user"
    assert smtp_settings.password == "smtp-secret"
    assert smtp_settings.secure is False


def test_passwordless_email_delivery_is_unset_when_smtp_is_disabled(monkeypatch):
    _disable_smtp(monkeypatch)

    assert config.get_passwordless_email_delivery() is None
