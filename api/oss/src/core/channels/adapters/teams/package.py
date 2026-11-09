"""The Teams app package: a zip with `manifest.json` and two icons that the
user uploads to Teams to install the bot. Manifest schema:
https://learn.microsoft.com/en-us/microsoftteams/platform/resources/schema/manifest-schema
"""

import base64
import io
import json
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import UUID, uuid5

from oss.src.core.channels.dtos import ChannelSetupDoc, ChannelSetupIdentity

# Teams keys an installed app on the manifest id, so the id must never change
# for one bot: a new id would install a second app instead of updating it.
MANIFEST_ID_NAMESPACE = UUID("99c7d0eb-7724-473e-aa40-53c4b6bfeed2")
# Teams ignores an uploaded package whose version it has already seen. Raise
# it whenever the generated manifest or the icons change.
MANIFEST_VERSION = "1.0.0"
MANIFEST_SCHEMA_VERSION = "1.16"

DEFAULT_NAME = "Agenta"
DEFAULT_DESCRIPTION = "An Agenta agent."
DEVELOPER_NAME = "Agenta"
# Teams accepts only HTTPS here, and a deployment's own web URL is often a
# plain HTTP local address.
DEVELOPER_WEBSITE_URL = "https://agenta.ai"
DEVELOPER_PRIVACY_URL = "https://agenta.ai/privacy-policy"
DEVELOPER_TERMS_URL = "https://agenta.ai/terms"
FILENAME = "agenta-teams-app.zip"

_SHORT_NAME_MAX = 30
_FULL_NAME_MAX = 100
_SHORT_DESCRIPTION_MAX = 80
_FULL_DESCRIPTION_MAX = 4000
_ACCENT_COLOR = "#1E1C1D"

_ICONS_DIR = Path(__file__).parent
# A fixed time for every zip entry, so one input always gives the same bytes.
_ZIP_ENTRY_TIME = (2026, 1, 1, 0, 0, 0)


def manifest_id(app_id: str) -> str:
    return str(uuid5(MANIFEST_ID_NAMESPACE, app_id))


def _fit(value: Optional[str], limit: int, default: str) -> str:
    """One line, at most `limit` characters, without leading or trailing
    spaces."""

    line = " ".join((value or "").split())
    return line[:limit].strip() or default


def build_manifest(
    *, app_id: str, identity: Optional[ChannelSetupIdentity]
) -> Dict[str, Any]:
    identity = identity or ChannelSetupIdentity()
    return {
        "$schema": (
            "https://developer.microsoft.com/en-us/json-schemas/teams/"
            f"v{MANIFEST_SCHEMA_VERSION}/MicrosoftTeams.schema.json"
        ),
        "manifestVersion": MANIFEST_SCHEMA_VERSION,
        "version": MANIFEST_VERSION,
        "id": manifest_id(app_id),
        "developer": {
            "name": DEVELOPER_NAME,
            "websiteUrl": DEVELOPER_WEBSITE_URL,
            "privacyUrl": DEVELOPER_PRIVACY_URL,
            "termsOfUseUrl": DEVELOPER_TERMS_URL,
        },
        "name": {
            "short": _fit(identity.name, _SHORT_NAME_MAX, DEFAULT_NAME),
            "full": _fit(identity.name, _FULL_NAME_MAX, DEFAULT_NAME),
        },
        "description": {
            "short": _fit(
                identity.description, _SHORT_DESCRIPTION_MAX, DEFAULT_DESCRIPTION
            ),
            "full": _fit(
                identity.description, _FULL_DESCRIPTION_MAX, DEFAULT_DESCRIPTION
            ),
        },
        "icons": {"color": "color.png", "outline": "outline.png"},
        "accentColor": _ACCENT_COLOR,
        "bots": [
            {
                "botId": app_id,
                "scopes": ["personal", "groupChat", "team"],
                "isNotificationOnly": False,
                "supportsFiles": False,
            }
        ],
        "validDomains": [],
    }


def build_package(*, app_id: str, identity: Optional[ChannelSetupIdentity]) -> bytes:
    manifest = build_manifest(app_id=app_id, identity=identity)
    entries = {
        "manifest.json": json.dumps(manifest, indent=2).encode(),
        "color.png": (_ICONS_DIR / "color.png").read_bytes(),
        "outline.png": (_ICONS_DIR / "outline.png").read_bytes(),
    }
    buffer = io.BytesIO()
    # Flat entries: Teams refuses a package whose files sit in a folder.
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in entries.items():
            archive.writestr(
                zipfile.ZipInfo(name, date_time=_ZIP_ENTRY_TIME),
                content,
                compress_type=zipfile.ZIP_DEFLATED,
            )
    return buffer.getvalue()


def build_setup_document(
    *, app_id: str, identity: Optional[ChannelSetupIdentity]
) -> ChannelSetupDoc:
    content = build_package(app_id=app_id, identity=identity)
    return ChannelSetupDoc(
        format="zip",
        content=base64.b64encode(content).decode("ascii"),
        filename=FILENAME,
    )
