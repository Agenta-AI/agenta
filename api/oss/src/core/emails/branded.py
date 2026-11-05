from html import escape
from pathlib import Path
from string import Template
from typing import NamedTuple, Sequence, Union

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


class Strong(NamedTuple):
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
<style>
body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a{color:#242424}
@media only screen and (max-width:600px){
.container{width:100%!important}
.gutter{padding:32px 24px!important}
}
@media (prefers-color-scheme:dark){
.bg{background-color:#151310!important}
.t-hi{color:#F7F6F4!important}
.t-mut{color:#BEBDBC!important}
.btn{background-color:#F2F25C!important}
.btn-text{color:#242424!important}
.logo-light{display:none!important}
.logo-dark{display:block!important;max-height:none!important}
}
[data-ogsc] .logo-light{display:none!important}
[data-ogsc] .logo-dark{display:block!important;max-height:none!important}
</style>
</head>
<body class="bg" style="margin:0;padding:0;background-color:#FFFFFF;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#FFFFFF;opacity:0;">$preheader$preheader_padding</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;">
<tr>
<td align="left">
<!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="container" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;">
<tr>
<td class="gutter" style="padding:48px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr>
<td style="padding:0 0 40px;">
<img class="logo-light" src="cid:$logo_light_cid" width="98" height="22" alt="Agenta" style="display:block;width:98px;height:22px;">
<!--[if !mso]><!--><img class="logo-dark" src="cid:$logo_dark_cid" width="97" height="22" alt="Agenta" style="display:none;max-height:0;overflow:hidden;width:97px;height:22px;"><!--<![endif]-->
</td>
</tr>
<tr>
<td>
<h1 class="sans t-hi" style="margin:0;font-family:$sans;font-weight:500;font-size:24px;line-height:30px;letter-spacing:-0.01em;color:#242424;mso-line-height-rule:exactly;">$headline</h1>
</td>
</tr>
$blocks
<tr>
<td class="sans t-mut" style="padding:40px 0 0;font-family:$sans;font-size:12px;line-height:18px;color:#676770;"><a class="t-mut" href="https://agenta.ai" style="color:#676770;">Agenta</a> &middot; AI coworkers that learn how you work.</td>
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
        blocks="\n".join(blocks),
    )


def paragraph_block(*, parts: Sequence[Union[str, Strong]]) -> str:
    text = "".join(
        f'<span class="t-hi" style="color:#242424;font-weight:500;">{escape(part.text)}</span>'
        if isinstance(part, Strong)
        else escape(part)
        for part in parts
    )
    return f"""<tr>
<td style="padding:16px 0 0;">
<p class="sans t-mut" style="margin:0;font-family:{_SANS};font-size:16px;line-height:24px;color:#676770;word-break:break-word;overflow-wrap:break-word;">{text}</p>
</td>
</tr>"""


def button_block(*, label: str, url: str) -> str:
    return f"""<tr>
<td style="padding:24px 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0">
<tr>
<td class="btn" align="center" style="background-color:#242424;border-radius:8px;mso-padding-alt:12px 20px;">
<a href="{escape(url, quote=True)}" class="sans btn-text" style="display:inline-block;border-radius:8px;padding:12px 20px;font-family:{_SANS};font-size:14px;line-height:20px;font-weight:400;letter-spacing:0.02em;color:#FFFFFF;text-decoration:none;">{escape(label)}</a>
</td>
</tr>
</table>
</td>
</tr>"""


def note_block(*, note: str) -> str:
    return f"""<tr>
<td style="padding:20px 0 0;">
<p class="sans t-mut" style="margin:0;font-family:{_SANS};font-size:14px;line-height:20px;color:#676770;">{escape(note)}</p>
</td>
</tr>"""
