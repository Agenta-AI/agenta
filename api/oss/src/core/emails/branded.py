from dataclasses import dataclass
from html import escape
from pathlib import Path
from string import Template
from typing import NamedTuple, Sequence

from oss.src.utils import emailing


FROM_NAME = "Agenta"

_ASSETS = Path(__file__).parent / "assets"

# Embedded in the message (cid:), so the email depends on no hosted asset.
LOGO_LIGHT = emailing.InlineImage(
    cid="agenta-logo-light",
    filename="agenta-logo.png",
    content=(_ASSETS / "agenta-logo-light.png").read_bytes(),
)
LOGO_DARK = emailing.InlineImage(
    cid="agenta-logo-dark",
    filename="agenta-logo-dark.png",
    content=(_ASSETS / "agenta-logo-dark.png").read_bytes(),
)
LOGOS = (LOGO_LIGHT, LOGO_DARK)

_SANS = (
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
    "'Helvetica Neue', Arial, sans-serif"
)

# Stops clients from filling the inbox preview with body text after the preheader.
_PREHEADER_PADDING = "&#8199;&#65279;&#847; " * 40


TEXT_FOOTER = "Agenta - AI coworkers that learn how you work.\nhttps://agenta.ai\n"


class Detail(NamedTuple):
    label: str
    value: str
    is_email: bool = False


@dataclass(frozen=True)
class BrandedEmail:
    subject: str
    html: str
    text: str


_LAYOUT = Template(
    """<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>$subject</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>.sans{font-family:'Segoe UI',Arial,sans-serif !important}</style>
<![endif]-->
<!--[if !mso]><!-->
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&amp;display=swap" rel="stylesheet">
<!--<![endif]-->
<style>
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a{color:#1E1C1D}
@media only screen and (max-width:600px){
.container{width:100%!important}
.gutter{padding:32px 16px 24px!important}
.pad{padding-left:16px!important;padding-right:16px!important}
.headline{font-size:24px!important;line-height:30px!important}
.code{font-size:40px!important;line-height:48px!important}
}
@media (prefers-color-scheme:dark){
.bg{background-color:#181010!important}
.card{background-color:#201A1A!important;border-color:#2D2626!important}
.panel{background-color:#2D2626!important}
.t-hi{color:#F6F5F3!important}
.t-mut{color:#9D9D9D!important}
.btn{background-color:#F6F5F3!important}
.btn-text{color:#181010!important}
.logo-light{display:none!important}
.logo-dark{display:block!important;max-height:none!important}
}
[data-ogsc] .logo-light{display:none!important}
[data-ogsc] .logo-dark{display:block!important;max-height:none!important}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background-color:#F6F5F3;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F6F5F3;opacity:0;">$preheader$preheader_padding</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F6F5F3;">
<tr>
<td align="center" class="gutter" style="padding:56px 24px 40px;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;">
<tr>
<td class="card" style="background-color:#ffffff;border:1px solid #EBEAEA;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td class="pad" style="padding:24px 32px 0;">
<img class="logo-light" src="cid:$logo_light_cid" width="98" height="22" alt="Agenta" style="display:block;width:98px;height:22px;">
<!--[if !mso]><!--><img class="logo-dark" src="cid:$logo_dark_cid" width="97" height="22" alt="Agenta" style="display:none;max-height:0;overflow:hidden;width:97px;height:22px;"><!--<![endif]-->
</td>
</tr>
<tr>
<td class="pad" style="padding:32px 32px 24px;">
<h1 class="sans headline t-hi" style="margin:0;font-family:$sans;font-weight:500;font-size:28px;line-height:34px;letter-spacing:-0.02em;color:#1E1C1D;mso-line-height-rule:exactly;">$headline</h1>
<p class="sans t-mut" style="margin:12px 0 0;font-family:$sans;font-size:15px;line-height:22px;color:#616161;">$description</p>
</td>
</tr>
$blocks
</table>
</td>
</tr>
<tr>
<td style="padding:24px 4px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td class="sans t-mut" align="left" valign="middle" style="font-family:$sans;font-size:12px;line-height:18px;letter-spacing:0.03em;color:#616161;">Agenta &middot; AI coworkers that learn how you work.</td>
<td class="sans" align="right" valign="middle" style="padding-left:16px;font-family:$sans;font-size:12px;line-height:18px;letter-spacing:0.03em;white-space:nowrap;"><a class="t-hi" href="https://agenta.ai" style="color:#1E1C1D;text-decoration:underline;text-decoration-color:#BCBCBC;text-underline-offset:3px;">agenta.ai</a></td>
</tr>
</table>
</td>
</tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>
"""
)


def render_layout(
    *,
    subject: str,
    preheader: str,
    headline: str,
    description: str,
    blocks: Sequence[str],
) -> str:
    """Wrap pre-rendered blocks in the Agenta email shell. Text arguments are escaped."""

    return _LAYOUT.substitute(
        subject=escape(subject),
        preheader=escape(preheader),
        preheader_padding=_PREHEADER_PADDING,
        logo_light_cid=LOGO_LIGHT.cid,
        logo_dark_cid=LOGO_DARK.cid,
        sans=_SANS,
        headline=escape(headline),
        description=escape(description),
        blocks="\n".join(blocks),
    )


def _plain_email(email: str) -> str:
    # Zero-width marks: wrap at the @, and stop Gmail auto-linking the domain.
    local, at, domain = escape(email).rpartition("@")
    if not at:
        return escape(email)
    return f"{local}&#8203;@{domain.replace('.', '&#8204;.')}"


def code_block(*, code: str) -> str:
    return f"""<tr>
<td class="pad" style="padding:0 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td class="panel" align="center" style="padding:28px 16px;background-color:#F6F5F3;border-radius:4px;">
<span class="sans code t-hi" style="display:inline-block;padding-left:0.16em;font-family:{_SANS};font-weight:400;font-size:48px;line-height:56px;letter-spacing:0.16em;font-variant-numeric:tabular-nums lining-nums;color:#1E1C1D;mso-line-height-rule:exactly;">{escape(code)}</span>
</td>
</tr>
</table>
</td>
</tr>"""


def button_block(*, label: str, url: str) -> str:
    return f"""<tr>
<td class="pad" style="padding:0 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td class="btn" align="center" style="background-color:#1E1C1D;border-radius:4px;">
<a href="{escape(url, quote=True)}" class="sans btn-text" style="display:block;border-radius:4px;padding:14px 16px;font-family:{_SANS};font-size:15px;line-height:20px;font-weight:500;color:#FFFFFF;text-decoration:none;">{escape(label)}</a>
</td>
</tr>
</table>
</td>
</tr>"""


def details_block(*, items: Sequence[Detail]) -> str:
    cells = "\n".join(
        f"""<td class="pad" width="50%" valign="top" style="width:50%;padding:24px 32px 0;">
<p class="sans t-mut" style="margin:0 0 4px;font-family:{_SANS};font-size:11px;line-height:18px;letter-spacing:0.03em;color:#616161;">{escape(label)}</p>
<p class="sans t-hi" style="margin:0;font-family:{_SANS};font-size:13px;line-height:20px;color:#1E1C1D;word-break:break-word;overflow-wrap:break-word;">{_plain_email(value) if is_email else escape(value)}</p>
</td>"""
        for label, value, is_email in items
    )
    return f"""<tr>
<td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
<tr>
{cells}
</tr>
</table>
</td>
</tr>"""


def note_block(*, note: str) -> str:
    return f"""<tr>
<td class="pad" style="padding:24px 32px 28px;">
<p class="sans t-mut" style="margin:0;font-family:{_SANS};font-size:13px;line-height:20px;color:#616161;">{escape(note)}</p>
</td>
</tr>"""


def details_text(*, items: Sequence[Detail]) -> str:
    return "\n".join(f"{item.label.capitalize()}: {item.value}" for item in items)


async def send_branded_email(
    *,
    to_email: str,
    email: BrandedEmail,
    #
    from_email: str | None = None,
) -> bool:
    return await emailing.send_html_email(
        to_email=to_email,
        subject=email.subject,
        html_content=email.html,
        text_content=email.text,
        inline_images=LOGOS,
        from_email=from_email,
        from_name=FROM_NAME,
    )
