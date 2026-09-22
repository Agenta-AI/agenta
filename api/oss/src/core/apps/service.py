"""Apps service: starter discovery, ``create_app`` copies, and ``app.json`` validation.

The bundle is a directory of ``<name>@<N>/`` starters next to this module. Every starter has
a ``SKILL.md`` whose front matter is the catalogue row (``list_starters``) and whose body opens
with the one-line "use this when". Copying goes through ``MountsService`` file ops so the app
lands in the drive exactly as an upload would; nothing here touches storage directly.

``validate_manifest`` mirrors ``parseManifest`` in
``web/packages/agenta-entities/src/drive/htmlApp/manifest.ts``: only bad JSON, a wrong
``agenta_app`` marker, a missing ``name`` or an ``entry`` that leaves the app dir make a folder
not-an-app; malformed optional fields fall back to their defaults.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

import yaml

from oss.src.core.mounts.types import MountFileNotFound

BUNDLE_STARTERS_DIR = Path(__file__).parent / "starters"
STARTER_SKILL_FILENAME = "SKILL.md"
STARTER_CONFIG_DEFAULTS = "config.defaults.json"
APP_MANIFEST_FILENAME = "app.json"
APP_DEFAULT_ENTRY = "index.html"
# Where an agent's own starters live inside its agent mount. The runner exposes that mount at
# ``agent-files/`` in the session cwd, so the agent sees ``agent-files/.apps/starters/``.
AGENT_STARTERS_DIR = ".apps/starters"
AGENT_STARTER_PREFIX = "agent:"

_STARTER_DIR_RE = re.compile(r"^(?P<name>[a-z0-9]+(?:-[a-z0-9]+)*)@(?P<version>\d+)$")
_STARTER_REF_RE = re.compile(
    r"^(?P<agent>agent:)?(?P<name>[a-z0-9]+(?:-[a-z0-9]+)*)(?:@(?P<version>\d+))?$"
)
_MANIFEST_KNOWN_KEYS = frozenset(
    {
        "agenta_app",
        "name",
        "icon",
        "entry",
        "template",
        "access",
        "data",
        "config",
        "kit",
        "refresh",
        "tools",
    }
)


class AppsError(Exception):
    """An expected failure the agent can act on. ``to_detail()`` is the AgentError payload."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        next_step: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.next_step = next_step
        self.details = details

    def to_detail(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "retryable": False,
            "next_step": self.next_step,
            "details": self.details,
        }


@dataclass(frozen=True)
class StarterInfo:
    name: str
    version: int
    when: str
    access: str = "read"
    config_keys: Tuple[str, ...] = ()
    data_files: Tuple[str, ...] = ()
    # ``bundle`` starters copy; ``agent`` starters are listed only (copying is phase 3).
    source: str = "bundle"

    @property
    def ref(self) -> str:
        prefix = AGENT_STARTER_PREFIX if self.source == "agent" else ""
        return f"{prefix}{self.name}@{self.version}"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "when": self.when,
            "config_keys": list(self.config_keys),
            "data_files": list(self.data_files),
            "access": self.access,
            "source": self.source,
        }


@dataclass(frozen=True)
class CreateAppResult:
    paths: List[str]
    template: str
    skipped: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"paths": self.paths, "template": self.template}
        if self.skipped:
            out["skipped"] = self.skipped
        return out


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------


def validate_manifest(text: str) -> Dict[str, Any]:
    """Parse an ``app.json`` the way the host does. Raises ``AppsError(invalid_manifest)``
    where ``parseManifest`` returns null; returns the normalised manifest otherwise."""

    def invalid(reason: str) -> AppsError:
        return AppsError(
            "invalid_manifest",
            f"app.json is not a valid app manifest: {reason}",
            next_step="Fix app.json so it carries agenta_app: 1, a name and a flat entry.",
        )

    try:
        raw = json.loads(text)
    except (json.JSONDecodeError, TypeError) as e:
        raise invalid("not valid JSON") from e
    if not isinstance(raw, dict):
        raise invalid("top level must be an object")
    if raw.get("agenta_app") != 1:
        raise invalid("agenta_app must be 1")
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip():
        raise invalid("name is required")

    entry = APP_DEFAULT_ENTRY
    if "entry" in raw:
        candidate = raw["entry"]
        if not isinstance(candidate, str) or candidate == "":
            raise invalid("entry must be a non-empty string")
        if "/" in candidate or "\\" in candidate or ".." in candidate:
            raise invalid("entry must be a bare filename in the app dir")
        entry = candidate

    manifest: Dict[str, Any] = {
        "agenta_app": 1,
        "name": name,
        "entry": entry,
        "access": raw.get("access")
        if raw.get("access") in ("read", "read-write")
        else "read",
        "kit": raw["kit"] if isinstance(raw.get("kit"), bool) else True,
    }
    if isinstance(raw.get("icon"), str):
        manifest["icon"] = raw["icon"]
    if isinstance(raw.get("template"), str) or raw.get("template") is None:
        if "template" in raw:
            manifest["template"] = raw["template"]
    if _is_string_list(raw.get("data")):
        manifest["data"] = list(raw["data"])
    if isinstance(raw.get("config"), str):
        manifest["config"] = raw["config"]
    if _is_string_list(raw.get("tools")):
        manifest["tools"] = list(raw["tools"])
    refresh = raw.get("refresh")
    if isinstance(refresh, dict) and isinstance(refresh.get("prompt"), str):
        manifest["refresh"] = {"prompt": refresh["prompt"]}
    extra = {k: v for k, v in raw.items() if k not in _MANIFEST_KNOWN_KEYS}
    if extra:
        manifest["extra"] = extra
    return manifest


def _is_string_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


# ---------------------------------------------------------------------------
# Starter front matter
# ---------------------------------------------------------------------------


def parse_starter_skill(text: str, *, source: str = "bundle") -> StarterInfo:
    """Front matter + first body line of a starter ``SKILL.md``."""
    if not text.startswith("---"):
        raise AppsError("invalid_starter", "starter SKILL.md has no front matter")
    parts = text.split("\n---", 2)
    if len(parts) < 2:
        raise AppsError(
            "invalid_starter", "starter SKILL.md front matter is unterminated"
        )
    header = parts[0][3:]
    body = parts[1] if len(parts) == 2 else parts[1] + parts[2]
    try:
        meta = yaml.safe_load(header) or {}
    except yaml.YAMLError as e:
        raise AppsError(
            "invalid_starter", f"starter SKILL.md front matter is not YAML: {e}"
        ) from e
    if not isinstance(meta, dict):
        raise AppsError("invalid_starter", "starter front matter must be a mapping")
    if meta.get("kind") != "app-starter":
        raise AppsError(
            "invalid_starter", "starter front matter needs kind: app-starter"
        )
    name = meta.get("name")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
        raise AppsError("invalid_starter", f"starter name {name!r} is not a slug")
    try:
        version = int(meta.get("version", 1))
    except (TypeError, ValueError) as e:
        raise AppsError("invalid_starter", "starter version must be an integer") from e
    when = next((line.strip() for line in body.splitlines() if line.strip()), "")
    access = (
        meta.get("access") if meta.get("access") in ("read", "read-write") else "read"
    )
    return StarterInfo(
        name=name,
        version=version,
        when=when,
        access=access,
        config_keys=tuple(_string_list(meta.get("config_keys"))),
        data_files=tuple(_string_list(meta.get("data_files"))),
        source=source,
    )


def _string_list(value: Any) -> List[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(item) for item in value]
    return []


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class AppsService:
    """``mounts_service`` is duck-typed: ``read_file``, ``write_file`` and ``list_files``."""

    def __init__(
        self,
        *,
        mounts_service: Any = None,
        starters_dir: Path = BUNDLE_STARTERS_DIR,
    ) -> None:
        self.mounts_service = mounts_service
        self.starters_dir = starters_dir

    # --- discovery -----------------------------------------------------------

    def list_bundle_starters(self) -> List[StarterInfo]:
        starters: List[StarterInfo] = []
        if not self.starters_dir.is_dir():
            return starters
        for path in sorted(self.starters_dir.iterdir()):
            match = _STARTER_DIR_RE.match(path.name)
            skill = path / STARTER_SKILL_FILENAME
            if not match or not skill.is_file():
                continue
            info = parse_starter_skill(skill.read_text(encoding="utf-8"))
            if info.name != match.group("name") or info.version != int(
                match.group("version")
            ):
                raise AppsError(
                    "invalid_starter",
                    f"starter dir {path.name} disagrees with its front matter "
                    f"({info.name}@{info.version})",
                )
            starters.append(info)
        return sorted(starters, key=lambda s: (s.name, s.version))

    async def list_agent_starters(
        self, *, project_id: UUID, mount_id: UUID
    ) -> List[StarterInfo]:
        """Starters the agent authored under ``.apps/starters/`` in its agent mount."""
        if self.mounts_service is None:
            return []
        try:
            listing = await self.mounts_service.list_files(
                project_id=project_id, mount_id=mount_id, path=AGENT_STARTERS_DIR
            )
        except MountFileNotFound:
            return []
        starters: List[StarterInfo] = []
        for entry in getattr(listing, "files", []) or []:
            if getattr(entry, "is_folder", False):
                continue
            rel = str(entry.path).strip("/")
            if rel.startswith(AGENT_STARTERS_DIR + "/"):
                rel = rel[len(AGENT_STARTERS_DIR) + 1 :]
            segments = rel.split("/")
            if len(segments) != 2 or segments[1] != STARTER_SKILL_FILENAME:
                continue
            content = await self.mounts_service.read_file(
                project_id=project_id,
                mount_id=mount_id,
                path=f"{AGENT_STARTERS_DIR}/{rel}",
            )
            try:
                starters.append(parse_starter_skill(content.content, source="agent"))
            except AppsError:
                continue  # a half-written starter must not hide the rest
        return sorted(starters, key=lambda s: (s.name, s.version))

    async def list_starters(
        self,
        *,
        project_id: Optional[UUID] = None,
        agent_mount_id: Optional[UUID] = None,
    ) -> List[StarterInfo]:
        starters = self.list_bundle_starters()
        if project_id is not None and agent_mount_id is not None:
            starters += await self.list_agent_starters(
                project_id=project_id, mount_id=agent_mount_id
            )
        return starters

    def resolve_bundle_starter(self, ref: str) -> Tuple[StarterInfo, Path]:
        match = _STARTER_REF_RE.match((ref or "").strip())
        available = self.list_bundle_starters()
        names = sorted({s.ref for s in available})
        if not match:
            raise AppsError(
                "unknown_starter",
                f"{ref!r} is not a starter reference.",
                next_step=f"Use one of: {', '.join(names)} (name or name@version).",
            )
        if match.group("agent"):
            raise AppsError(
                "starter_not_copyable",
                "Agent-authored starters can be listed but not copied yet.",
                next_step="Copy the files from agent-files/.apps/starters/ yourself, "
                "or pick a bundled starter.",
            )
        name = match.group("name")
        wanted = int(match.group("version")) if match.group("version") else None
        candidates = [s for s in available if s.name == name]
        if wanted is not None:
            candidates = [s for s in candidates if s.version == wanted]
        if not candidates:
            raise AppsError(
                "unknown_starter",
                f"No starter matches {ref!r}.",
                next_step=f"Use one of: {', '.join(names)}.",
            )
        starter = max(candidates, key=lambda s: s.version)
        return starter, self.starters_dir / f"{starter.name}@{starter.version}"

    # --- create --------------------------------------------------------------

    async def create_app(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        starter: str,
        dir: str,
        update: bool = False,
    ) -> CreateAppResult:
        if self.mounts_service is None:
            raise AppsError(
                "unavailable", "create_app has no drive to write to on this deployment."
            )
        app_dir = _normalise_dir(dir)
        info, source_dir = self.resolve_bundle_starter(starter)
        template = info.ref

        manifest_path = f"{app_dir}/{APP_MANIFEST_FILENAME}"
        existing: Optional[Dict[str, Any]] = None
        try:
            current = await self.mounts_service.read_file(
                project_id=project_id, mount_id=mount_id, path=manifest_path
            )
        except MountFileNotFound:
            current = None
        if current is not None:
            if not update:
                raise AppsError(
                    "app_exists",
                    f"{manifest_path} already exists.",
                    next_step="Update that app instead of creating a second one, or call "
                    "create_app again with update=true to refresh its template files.",
                )
            try:
                existing = validate_manifest(current.content)
            except AppsError:
                existing = None

        starter_manifest = validate_manifest(
            (source_dir / APP_MANIFEST_FILENAME).read_text(encoding="utf-8")
        )
        # The user's content: whatever the live manifest names, else the starter's own list,
        # plus the config file, which the person (or agent) edits after the copy.
        protected = set((existing or starter_manifest).get("data") or [])
        config_name = (existing or starter_manifest).get("config")
        if config_name:
            protected.add(config_name)

        written: List[str] = []
        skipped: List[str] = []

        async def put(rel: str, text: str) -> None:
            path = f"{app_dir}/{rel}"
            if update and rel in protected:
                skipped.append(path)
                return
            await self.mounts_service.write_file(
                project_id=project_id,
                mount_id=mount_id,
                path=path,
                content=text.encode("utf-8"),
            )
            written.append(path)

        for file in sorted(source_dir.iterdir()):
            if not file.is_file() or file.name in (
                STARTER_SKILL_FILENAME,
                STARTER_CONFIG_DEFAULTS,
            ):
                continue
            text = file.read_text(encoding="utf-8")
            if file.name == APP_MANIFEST_FILENAME:
                text = _stamp_template(text, template)
            await put(file.name, text)

        defaults = source_dir / STARTER_CONFIG_DEFAULTS
        if config_name and defaults.is_file():
            if update and existing is not None:
                skipped.append(f"{app_dir}/{config_name}")
            else:
                await put(config_name, defaults.read_text(encoding="utf-8"))

        return CreateAppResult(paths=written, template=template, skipped=skipped)


def _normalise_dir(raw: str) -> str:
    value = (raw or "").strip().strip("/")
    if not value or "\\" in value or any(ord(c) < 0x20 for c in value):
        raise AppsError(
            "invalid_dir",
            f"{raw!r} is not a valid app directory.",
            next_step="Pass a relative folder such as apps/<slug>.",
        )
    if any(seg in ("", ".", "..") for seg in value.split("/")):
        raise AppsError(
            "invalid_dir",
            f"{raw!r} must not contain empty, '.' or '..' segments.",
            next_step="Pass a relative folder such as apps/<slug>.",
        )
    return value


def _stamp_template(manifest_text: str, template: str) -> str:
    data = json.loads(manifest_text)
    data["template"] = template
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"
