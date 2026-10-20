from oss.src.core.emails.branded import (
    TEXT_FOOTER,
    BrandedEmail,
    Detail,
    button_block,
    details_block,
    details_text,
    note_block,
    render_layout,
)


def _render(
    *,
    subject: str,
    headline: str,
    description: str,
    button: str,
    url: str,
    details: list[Detail],
    note: str,
) -> BrandedEmail:
    # Names come from users; a CR/LF in a header value makes the send fail.
    subject = " ".join(subject.split())
    html = render_layout(
        subject=subject,
        preheader=description,
        headline=headline,
        description=description,
        blocks=[
            button_block(label=button, url=url),
            details_block(items=details),
            note_block(note=note),
        ],
    )
    text = (
        f"{headline}\n\n{description}\n\n{button}: {url}\n\n"
        f"{details_text(items=details)}\n\n{note}\n\n{TEXT_FOOTER}"
    )
    return BrandedEmail(subject=subject, html=html, text=text)


def render_invitation_email(
    *, inviter: str, organization: str, url: str
) -> BrandedEmail:
    return _render(
        subject=f"{inviter} invited you to {organization} on Agenta",
        headline=f"Join {organization} on Agenta",
        description=f"{inviter} invited you to work with their team in Agenta.",
        button="Accept invitation",
        url=url,
        details=[Detail("INVITED BY", inviter), Detail("ORGANIZATION", organization)],
        note="Not expecting this invitation? Ignore this email. Nothing changes until you accept.",
    )


def render_member_joined_email(
    *,
    member_name: str,
    member_email: str,
    organization: str,
    url: str,
) -> BrandedEmail:
    return _render(
        subject=f"{member_name} joined {organization}",
        headline=f"{member_name} joined your workspace",
        description=f"{member_name} accepted the invitation and can now work in {organization}.",
        button="View members",
        url=url,
        details=[
            Detail("NEW MEMBER", member_email, is_email=True),
            Detail("WORKSPACE", organization),
        ],
        note=f"You get this email because you are an admin of {organization}.",
    )


def render_password_reset_email(
    *, admin_name: str, email: str, url: str
) -> BrandedEmail:
    return _render(
        subject="Reset your Agenta password",
        headline="Reset your password",
        description=(
            f"{admin_name}, an admin of your workspace, asked for a password reset "
            "for your account."
        ),
        button="Reset password",
        url=url,
        details=[
            Detail("REQUESTED BY", admin_name),
            Detail("ACCOUNT", email, is_email=True),
        ],
        note="Not expecting this? Ignore this email. Your password stays the same.",
    )
