from typing import Any, Dict, List, Optional
from uuid import UUID

from oss.src.core.browser_profiles.controller_client import BrowserControllerClient
from oss.src.core.browser_profiles.dtos import (
    BrowserLiveStatus,
    BrowserProfile,
    BrowserProfileCreate,
    BrowserProfileEdit,
    BrowserProfileState,
    BrowserSandbox,
    BrowserScope,
)
from oss.src.core.browser_profiles.interfaces import BrowserProfilesDAOInterface
from oss.src.core.browser_profiles.policy import (
    check_tool_access,
    normalize_allowed_hosts,
)
from oss.src.core.browser_profiles.runner_client import BrowserRunnerClient
from oss.src.core.browser_profiles.session_state import (
    merge_storage_states,
    rebase_share,
    session_label,
    split_storage_state,
    sites,
    union_hosts,
)
from oss.src.core.browser_profiles.types import (
    BrowserLoginNotStarted,
    BrowserProfileNotFound,
    BrowserToolError,
    BrowserUnavailable,
)
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


class BrowserProfilesService:
    def __init__(
        self,
        *,
        browser_profiles_dao: BrowserProfilesDAOInterface,
        runner_client: Optional[BrowserRunnerClient] = None,
        controller_client: Optional[BrowserControllerClient] = None,
    ):
        self.browser_profiles_dao = browser_profiles_dao
        self.runner_client = runner_client or BrowserRunnerClient()
        self.controller_client = controller_client or BrowserControllerClient()

    async def create_profile(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        profile_create: BrowserProfileCreate,
    ) -> BrowserProfile:
        return await self.browser_profiles_dao.create_profile(
            project_id=project_id,
            user_id=user_id,
            name=profile_create.name,
            allowed_hosts=normalize_allowed_hosts(profile_create.allowed_hosts),
        )

    async def query_profiles(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
    ) -> List[BrowserProfile]:
        return await self.browser_profiles_dao.query_profiles(
            project_id=project_id,
            user_id=user_id,
        )

    async def fetch_profile(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        profile_id: UUID,
    ) -> BrowserProfile:
        profile = await self.browser_profiles_dao.fetch_profile(
            project_id=project_id,
            profile_id=profile_id,
        )
        if profile is None or profile.created_by_id != user_id:
            raise BrowserProfileNotFound()
        return profile

    async def edit_profile(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        profile_id: UUID,
        profile_edit: BrowserProfileEdit,
    ) -> BrowserProfile:
        await self.fetch_profile(
            project_id=project_id, user_id=user_id, profile_id=profile_id
        )
        profile = await self.browser_profiles_dao.edit_profile(
            project_id=project_id,
            user_id=user_id,
            profile_id=profile_id,
            name=profile_edit.name,
            allowed_hosts=(
                normalize_allowed_hosts(profile_edit.allowed_hosts)
                if profile_edit.allowed_hosts is not None
                else None
            ),
        )
        if profile is None:
            raise BrowserProfileNotFound()
        if profile_edit.allowed_hosts is not None:
            # A running browser keeps the allowlist it was set up with.
            await self._stop_browsers(
                project_id=project_id, user_id=user_id, profile_id=profile_id
            )
        return profile

    async def archive_profile(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        profile_id: UUID,
    ) -> BrowserProfile:
        await self.fetch_profile(
            project_id=project_id, user_id=user_id, profile_id=profile_id
        )
        profile = await self.browser_profiles_dao.archive_profile(
            project_id=project_id,
            user_id=user_id,
            profile_id=profile_id,
        )
        if profile is None:
            raise BrowserProfileNotFound()
        await self._stop_browsers(
            project_id=project_id, user_id=user_id, profile_id=profile_id
        )
        return profile

    async def start_login(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        profile_id: UUID,
    ) -> BrowserProfile:
        profile = await self.fetch_profile(
            project_id=project_id, user_id=user_id, profile_id=profile_id
        )
        sandbox = await self.runner_client.ensure(
            project_id=project_id,
            scope=BrowserScope.LOGIN,
            ref=str(profile_id),
            label=str(profile_id),
        )
        await self._setup(sandbox, project_id=project_id, profile=profile)
        try:
            await self.controller_client.op(
                sandbox,
                op="navigate",
                args={"url": f"https://{profile.allowed_hosts[0]}"},
            )
        except BrowserToolError as e:
            log.warning("[browser] login start could not open the first site: %s", e)
        return profile

    async def finish_login(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        profile_id: UUID,
    ) -> BrowserProfile:
        await self.fetch_profile(
            project_id=project_id, user_id=user_id, profile_id=profile_id
        )
        sandbox = await self.runner_client.find(
            project_id=project_id,
            scope=BrowserScope.LOGIN,
            ref=str(profile_id),
            label=str(profile_id),
        )
        if sandbox is None:
            raise BrowserLoginNotStarted()
        state = await self.controller_client.state(sandbox)
        profile = await self.browser_profiles_dao.store_login_state(
            project_id=project_id,
            user_id=user_id,
            profile_id=profile_id,
            storage_state=state.storage_state,
        )
        if profile is None:
            raise BrowserProfileNotFound()
        await self.runner_client.delete(
            project_id=project_id, scope=BrowserScope.LOGIN, ref=str(profile_id)
        )
        return profile

    async def cancel_login(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        profile_id: UUID,
    ) -> None:
        await self.fetch_profile(
            project_id=project_id, user_id=user_id, profile_id=profile_id
        )
        await self.runner_client.delete(
            project_id=project_id, scope=BrowserScope.LOGIN, ref=str(profile_id)
        )

    async def find_login_browser(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        profile_id: UUID,
    ) -> Optional[BrowserSandbox]:
        await self.fetch_profile(
            project_id=project_id, user_id=user_id, profile_id=profile_id
        )
        return await self.runner_client.find(
            project_id=project_id,
            scope=BrowserScope.LOGIN,
            ref=str(profile_id),
            label=str(profile_id),
        )

    async def find_session_browser(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        session_id: str,
    ) -> Optional[BrowserSandbox]:
        """The caller's own browser of the session."""
        return await self.runner_client.find(
            project_id=project_id,
            scope=BrowserScope.SESSION,
            ref=session_id,
            label=session_label(user_id),
        )

    async def live_status(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        session_id: str,
    ) -> BrowserLiveStatus:
        try:
            sandbox = await self.find_session_browser(
                project_id=project_id, user_id=user_id, session_id=session_id
            )
        except BrowserUnavailable:
            sandbox = None
        return BrowserLiveStatus(running=sandbox is not None)

    async def available_profile_ids(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        is_draft: bool,
        revision_author_id: Optional[UUID],
    ) -> Optional[List[UUID]]:
        """The run user's ready logins, or None when another user committed the revision."""
        if not is_draft and revision_author_id != user_id:
            return None
        profiles = await self.browser_profiles_dao.query_profiles(
            project_id=project_id, user_id=user_id
        )
        return [p.id for p in profiles if p.state == BrowserProfileState.READY]

    async def run_tool(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        session_id: str,
        profile_ids: List[UUID],
        is_draft: bool,
        revision_author_id: Optional[UUID],
        #
        op: str,
        args: Dict[str, Any],
    ) -> str:
        profiles: List[BrowserProfile] = []
        refused: Optional[BrowserToolError] = None
        for profile_id in profile_ids:
            profile = await self.browser_profiles_dao.fetch_profile(
                project_id=project_id, profile_id=profile_id
            )
            try:
                check_tool_access(
                    profile=profile,
                    user_id=user_id,
                    is_draft=is_draft,
                    revision_author_id=revision_author_id,
                )
            except BrowserToolError as e:
                refused = refused or e
                continue
            profiles.append(profile)
        if not profiles:
            raise refused or BrowserProfileNotFound()
        logins = [str(p.id) for p in profiles]
        sandbox = await self.runner_client.ensure(
            project_id=project_id,
            scope=BrowserScope.SESSION,
            ref=session_id,
            label=session_label(user_id),
        )
        try:
            result = await self.controller_client.op(
                sandbox, op=op, args=args, logins=logins
            )
        except BrowserToolError as e:
            if e.code == "logins_changed":
                # The run may use other logins than this warm browser holds: start a fresh one.
                await self.runner_client.delete(
                    project_id=project_id,
                    scope=BrowserScope.SESSION,
                    ref=session_id,
                    label=session_label(user_id),
                )
                sandbox = await self.runner_client.ensure(
                    project_id=project_id,
                    scope=BrowserScope.SESSION,
                    ref=session_id,
                    label=session_label(user_id),
                )
            elif e.code != "not_setup":
                raise
            await self._setup_session(sandbox, project_id=project_id, profiles=profiles)
            result = await self.controller_client.op(
                sandbox, op=op, args=args, logins=logins
            )
        if result.state_dirty:
            await self._save_session(sandbox, project_id=project_id, profiles=profiles)
        return result.text

    async def _stop_browsers(
        self, *, project_id: UUID, user_id: UUID, profile_id: UUID
    ) -> None:
        """The login's own browser and every session browser of its owner, which may hold it."""
        await self.runner_client.delete(project_id=project_id, label=str(profile_id))
        await self.runner_client.delete(
            project_id=project_id, label=session_label(user_id)
        )

    async def _setup(
        self,
        sandbox: BrowserSandbox,
        *,
        project_id: UUID,
        profile: BrowserProfile,
    ) -> None:
        session_state = await self.browser_profiles_dao.fetch_session_state(
            project_id=project_id, profile_id=profile.id
        )
        if session_state is None:
            raise BrowserProfileNotFound()
        await self.controller_client.setup(
            sandbox,
            allowed_hosts=sites(profile),
            storage_state=session_state.storage_state,
            generation=session_state.generation,
        )

    async def _setup_session(
        self,
        sandbox: BrowserSandbox,
        *,
        project_id: UUID,
        profiles: List[BrowserProfile],
    ) -> None:
        states: Dict[UUID, Optional[Dict[str, Any]]] = {}
        generations: Dict[str, int] = {}
        for profile in profiles:
            saved = await self.browser_profiles_dao.fetch_session_state(
                project_id=project_id, profile_id=profile.id
            )
            if saved is None:
                continue
            states[profile.id] = saved.storage_state
            generations[str(profile.id)] = saved.generation
        if not generations:
            raise BrowserProfileNotFound()
        loaded = [p for p in profiles if str(p.id) in generations]
        await self.controller_client.setup(
            sandbox,
            allowed_hosts=union_hosts(loaded),
            storage_state=merge_storage_states(states, loaded),
            generation=generations,
        )

    async def _save_session(
        self,
        sandbox: BrowserSandbox,
        *,
        project_id: UUID,
        profiles: List[BrowserProfile],
    ) -> None:
        try:
            state = await self.controller_client.state(sandbox)
        except BrowserToolError as e:
            log.warning("browser.state", outcome="unread", code=e.code)
            return
        generations = state.generation if isinstance(state.generation, dict) else {}
        # Split among the logins this browser loaded, each under its own generation guard.
        loaded = [p for p in profiles if str(p.id) in generations]
        shares = split_storage_state(state.storage_state, loaded)
        for profile in loaded:
            stored = await self.browser_profiles_dao.fetch_session_state(
                project_id=project_id, profile_id=profile.id
            )
            saved = await self.browser_profiles_dao.save_session_state(
                project_id=project_id,
                profile_id=profile.id,
                generation=int(generations[str(profile.id)]),
                storage_state=rebase_share(
                    stored.storage_state if stored else None,
                    shares[profile.id],
                    profile.id,
                    loaded,
                ),
            )
            if not saved:
                log.info(
                    "browser.state",
                    outcome="stale",
                    profile_id=str(profile.id),
                    generation=generations[str(profile.id)],
                )
