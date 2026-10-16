import base64
from unittest.mock import AsyncMock, Mock

import pytest
from supertokens_python.recipe.passwordless.types import (
    CreateAndSendCustomEmailParameters,
)

from oss.src.core.auth.supertokens import otp_email
from oss.src.core.emails import branded, templates
from oss.src.utils import emailing
from oss.src.utils.env import env


def _template_vars(email="you@company.com", code="482913"):
    return CreateAndSendCustomEmailParameters(
        tenant_id="public",
        code_life_time=900_000,
        pre_auth_session_id="pre-auth",
        email=email,
        is_first_factor=True,
        user_input_code=code,
    )


def _configure_mailer(monkeypatch, *, enabled):
    monkeypatch.setattr(env.smtp, "host", "smtp.example.com" if enabled else None)
    monkeypatch.setattr(env.smtp, "port", 587 if enabled else None)
    monkeypatch.setattr(env.smtp, "from_email", "smtp@example.com" if enabled else None)
    monkeypatch.setattr(env.sendgrid, "api_key", None)
    monkeypatch.setattr(env.sendgrid, "from_email", None)


class FakeOriginal:
    def __init__(self):
        self.send_email = AsyncMock()


def test_render_escapes_email_and_humanizes_expiry():
    rendered = otp_email.render_otp_email(
        code="482913",
        email="a<b>@example.com",
        code_life_time_ms=900_000,
    )

    assert "a&lt;b&gt;&#8203;@example&#8204;.com" in rendered.html
    assert "a<b>@example.com" not in rendered.html
    assert ">482913</span>" in rendered.html
    assert "This code expires in 15 minutes." in rendered.html
    assert "Expires in: 15 minutes\nRequested for: a<b>@example.com" in rendered.text


def test_render_embeds_logo_inline():
    rendered = otp_email.render_otp_email(
        code="482913",
        email="you@company.com",
        code_life_time_ms=900_000,
    )

    for logo in branded.LOGOS:
        assert f'src="cid:{logo.cid}"' in rendered.html
        assert logo.content.startswith(b"\x89PNG")
    assert 'src="http' not in rendered.html
    assert "prefers-color-scheme:dark" in rendered.html


def test_smtp_message_nests_inline_image_under_html():
    logo = emailing.InlineImage(cid="logo", filename="logo.png", content=b"\x89PNG")

    message = emailing._build_smtp_message(
        to_email="you@company.com",
        subject="Subject",
        html_content='<img src="cid:logo">',
        from_email="from@example.com",
        text_content="plain",
        inline_images=[logo],
    )

    assert message.get_content_type() == "multipart/alternative"
    text_part, html_part = message.get_payload()
    assert text_part.get_content_type() == "text/plain"
    assert html_part.get_content_type() == "multipart/related"
    html, image = html_part.get_payload()
    assert html.get_content_type() == "text/html"
    assert image.get_content_type() == "image/png"
    assert image["Content-ID"] == "<logo>"
    assert image.get_content_disposition() == "inline"


def test_sendgrid_message_attaches_inline_image(monkeypatch):
    fake_sendgrid = Mock()
    monkeypatch.setattr(emailing, "_load_sendgrid", Mock(return_value=fake_sendgrid))
    logo = emailing.InlineImage(cid="logo", filename="logo.png", content=b"\x89PNG")

    assert emailing._send_sendgrid_email_sync(
        to_email="you@company.com",
        subject="Subject",
        html_content='<img src="cid:logo">',
        from_email="from@example.com",
        text_content="plain",
        inline_images=[logo],
    )

    (attachment,) = fake_sendgrid.send.call_args.args[0].get()["attachments"]
    assert attachment["content_id"] == "logo"
    assert attachment["disposition"] == "inline"
    assert attachment["type"] == "image/png"
    assert base64.b64decode(attachment["content"]) == b"\x89PNG"


def test_sendgrid_reports_not_sent_without_client(monkeypatch):
    monkeypatch.setattr(emailing, "_load_sendgrid", Mock(return_value=None))

    assert not emailing._send_sendgrid_email_sync(
        to_email="you@company.com",
        subject="Subject",
        html_content="<p>Hi</p>",
        from_email="from@example.com",
    )


@pytest.mark.parametrize(
    ("sender", "expected"),
    [
        ("account@hello.agenta.ai", "Agenta <account@hello.agenta.ai>"),
        ("Team <team@agenta.ai>", "Team <team@agenta.ai>"),
    ],
)
def test_display_name_added_only_when_missing(sender, expected):
    assert emailing._with_display_name(sender, "Agenta") == expected


@pytest.mark.parametrize(
    ("milliseconds", "expected"),
    [
        (900_000, "15 minutes"),
        (60_000, "1 minute"),
        (3_600_000, "1 hour"),
        (10, "1 minute"),
    ],
)
def test_humanize_duration(milliseconds, expected):
    assert otp_email._humanize_duration(milliseconds) == expected


@pytest.mark.asyncio
async def test_sends_branded_email_when_mailer_configured(monkeypatch):
    _configure_mailer(monkeypatch, enabled=True)
    send_html_email = AsyncMock(return_value=True)
    monkeypatch.setattr(emailing, "send_html_email", send_html_email)
    original = FakeOriginal()
    original_send_email = original.send_email

    delivery = otp_email.override_passwordless_email_delivery(original)
    await delivery.send_email(_template_vars(), {})

    original_send_email.assert_not_awaited()
    kwargs = send_html_email.await_args.kwargs
    assert kwargs["to_email"] == "you@company.com"
    assert kwargs["subject"] == "Your Agenta sign-in code"
    assert kwargs["from_name"] == "Agenta"
    assert "482913" in kwargs["text_content"]
    assert [image.cid for image in kwargs["inline_images"]] == [
        "agenta-logo-light",
        "agenta-logo-dark",
    ]


@pytest.mark.asyncio
async def test_uses_supertokens_delivery_without_mailer(monkeypatch):
    _configure_mailer(monkeypatch, enabled=False)
    send_html_email = AsyncMock(return_value=True)
    monkeypatch.setattr(emailing, "send_html_email", send_html_email)
    original = FakeOriginal()
    original_send_email = original.send_email
    template_vars = _template_vars()

    delivery = otp_email.override_passwordless_email_delivery(original)
    await delivery.send_email(template_vars, {})

    send_html_email.assert_not_awaited()
    original_send_email.assert_awaited_once_with(template_vars, {})


@pytest.mark.asyncio
async def test_falls_back_to_supertokens_when_send_fails(monkeypatch):
    _configure_mailer(monkeypatch, enabled=True)
    monkeypatch.setattr(
        emailing,
        "send_html_email",
        AsyncMock(side_effect=RuntimeError("smtp down")),
    )
    original = FakeOriginal()
    original_send_email = original.send_email
    template_vars = _template_vars()

    delivery = otp_email.override_passwordless_email_delivery(original)
    await delivery.send_email(template_vars, {})

    original_send_email.assert_awaited_once_with(template_vars, {})


@pytest.mark.asyncio
async def test_falls_back_to_supertokens_when_nothing_was_sent(monkeypatch):
    _configure_mailer(monkeypatch, enabled=True)
    monkeypatch.setattr(emailing, "send_html_email", AsyncMock(return_value=False))
    original = FakeOriginal()
    original_send_email = original.send_email
    template_vars = _template_vars()

    delivery = otp_email.override_passwordless_email_delivery(original)
    await delivery.send_email(template_vars, {})

    original_send_email.assert_awaited_once_with(template_vars, {})


@pytest.mark.parametrize(
    "rendered",
    [
        templates.render_invitation_email(
            inviter="<b>Eve</b>",
            organization="Acme & Co",
            url="https://x.test/a?b=1&c=2",
        ),
        templates.render_member_joined_email(
            member_name="<b>Eve</b>",
            member_email="eve@acme.com",
            organization="Acme & Co",
            url="https://x.test/a?b=1&c=2",
        ),
        templates.render_password_reset_email(
            admin_name="<b>Eve</b>",
            email="eve@acme.com",
            url="https://x.test/a?b=1&c=2",
        ),
    ],
)
def test_action_emails_escape_user_values_and_link_the_button(rendered):
    assert "<b>Eve</b>" not in rendered.html
    assert "&lt;b&gt;Eve&lt;/b&gt;" in rendered.html
    assert 'href="https://x.test/a?b=1&amp;c=2"' in rendered.html
    assert "https://x.test/a?b=1&c=2" in rendered.text
    assert f'src="cid:{branded.LOGO_LIGHT.cid}"' in rendered.html
