from datetime import datetime, timezone
from uuid import UUID

import pytest

from oss.src.core.browser_profiles.dtos import (
    BrowserControllerState,
    BrowserOpResult,
    BrowserProfile,
    BrowserProfileState,
    BrowserSandbox,
    BrowserScope,
    BrowserSessionState,
)
from oss.src.core.browser_profiles.service import BrowserProfilesService
from oss.src.core.browser_profiles.types import BrowserToolError

PROJECT = UUID("00000000-0000-0000-0000-000000000001")
OWNER = UUID("00000000-0000-0000-0000-00000000000a")
STRANGER = UUID("00000000-0000-0000-0000-00000000000b")
GITHUB = UUID("00000000-0000-0000-0000-0000000000a1")
BITBUCKET = UUID("00000000-0000-0000-0000-0000000000b2")
NOT_MINE = UUID("00000000-0000-0000-0000-0000000000c3")

PROFILES = {
    GITHUB: BrowserProfile(
        id=GITHUB,
        name="GitHub",
        allowed_hosts=["github.com"],
        state=BrowserProfileState.READY,
        generation=4,
        created_by_id=OWNER,
        updated_at=datetime(2026, 10, 9, tzinfo=timezone.utc),
    ),
    BITBUCKET: BrowserProfile(
        id=BITBUCKET,
        name="Bitbucket",
        allowed_hosts=["bitbucket.org"],
        state=BrowserProfileState.READY,
        generation=2,
        created_by_id=OWNER,
        updated_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
    ),
    NOT_MINE: BrowserProfile(
        id=NOT_MINE,
        name="Theirs",
        allowed_hosts=["example.com"],
        state=BrowserProfileState.READY,
        generation=1,
        created_by_id=STRANGER,
    ),
}
STATES = {
    GITHUB: {"cookies": [{"name": "gh", "domain": ".github.com"}], "origins": []},
    BITBUCKET: {"cookies": [{"name": "bb", "domain": "bitbucket.org"}], "origins": []},
}


class DAO:
    def __init__(self):
        self.saved = []

    async def fetch_profile(self, *, project_id, profile_id):
        return PROFILES.get(profile_id)

    async def fetch_session_state(self, *, project_id, profile_id):
        return BrowserSessionState(
            storage_state=STATES[profile_id],
            generation=PROFILES[profile_id].generation,
        )

    async def save_session_state(
        self, *, project_id, profile_id, generation, storage_state
    ):
        self.saved.append((profile_id, generation, storage_state))
        return True


class Runner:
    def __init__(self):
        self.ensured = []
        self.deleted = []

    async def ensure(self, **key):
        self.ensured.append(key)
        return BrowserSandbox(sandbox_id="b", url="http://b", headers={}, label="x")

    async def delete(self, **target):
        self.deleted.append(target)


class Controller:
    def __init__(self, warm_with=None):
        self.setups = []
        self.ops = 0
        self.logins = []
        # A warm browser that already holds these logins, or none.
        self.warm_with = warm_with

    async def op(self, sandbox, *, op, args, logins=None):
        self.ops += 1
        self.logins.append(logins)
        self.args = args
        if self.warm_with is not None and not self.setups:
            if sorted(self.warm_with) != sorted(logins or []):
                raise BrowserToolError(
                    code="logins_changed", message="Other logins than the run may use."
                )
            return BrowserOpResult(text="done")
        if not self.setups:
            raise BrowserToolError(
                code="not_setup", message="The browser is not set up yet."
            )
        return BrowserOpResult(text="done", state_dirty=True)

    async def setup(self, sandbox, *, allowed_hosts, storage_state, generation):
        self.setups.append((allowed_hosts, storage_state, generation))

    async def state(self, sandbox):
        return BrowserControllerState(
            storage_state={
                "cookies": [
                    {"name": "gh2", "domain": "github.com"},
                    {"name": "bb2", "domain": ".bitbucket.org"},
                    {"name": "ad", "domain": "ads.example.net"},
                ],
                "origins": [],
            },
            generation=self.setups[0][2],
        )


@pytest.mark.asyncio
async def test_one_browser_holds_every_allowed_login_and_saves_each_share():
    dao, runner, controller = DAO(), Runner(), Controller()
    service = BrowserProfilesService(
        browser_profiles_dao=dao,  # type: ignore[arg-type]
        runner_client=runner,  # type: ignore[arg-type]
        controller_client=controller,  # type: ignore[arg-type]
    )

    text = await service.run_tool(
        project_id=PROJECT,
        user_id=OWNER,
        session_id="sess-1",
        profile_ids=[GITHUB, BITBUCKET, NOT_MINE],
        is_draft=True,
        revision_author_id=None,
        op="navigate",
        args={"url": "https://github.com"},
    )

    assert text == "done"
    assert runner.ensured[0]["label"] == f"user-{OWNER}"
    hosts, merged, generation = controller.setups[0]
    assert hosts == ["bitbucket.org", "github.com"]
    assert sorted(c["name"] for c in merged["cookies"]) == ["bb", "gh"]
    assert generation == {str(GITHUB): 4, str(BITBUCKET): 2}
    assert sorted(
        (pid, gen, [c["name"] for c in s["cookies"]]) for pid, gen, s in dao.saved
    ) == [
        (GITHUB, 4, ["gh2"]),
        (BITBUCKET, 2, ["bb2"]),
    ]


@pytest.mark.asyncio
async def test_a_run_with_no_usable_login_is_refused_before_any_browser():
    runner = Runner()
    service = BrowserProfilesService(
        browser_profiles_dao=DAO(),  # type: ignore[arg-type]
        runner_client=runner,  # type: ignore[arg-type]
        controller_client=Controller(),  # type: ignore[arg-type]
    )

    with pytest.raises(BrowserToolError) as refused:
        await service.run_tool(
            project_id=PROJECT,
            user_id=OWNER,
            session_id="sess-1",
            profile_ids=[NOT_MINE],
            is_draft=True,
            revision_author_id=None,
            op="navigate",
            args={},
        )

    assert refused.value.code == "profile_not_available"
    assert runner.ensured == []


@pytest.mark.asyncio
async def test_available_logins_are_none_for_another_authors_revision():
    class ListingDAO(DAO):
        async def query_profiles(self, *, project_id, user_id):
            return [PROFILES[GITHUB], PROFILES[BITBUCKET]]

    service = BrowserProfilesService(browser_profiles_dao=ListingDAO())  # type: ignore[arg-type]

    mine = await service.available_profile_ids(
        project_id=PROJECT, user_id=OWNER, is_draft=False, revision_author_id=OWNER
    )
    theirs = await service.available_profile_ids(
        project_id=PROJECT, user_id=OWNER, is_draft=False, revision_author_id=STRANGER
    )

    assert mine == [GITHUB, BITBUCKET]
    assert theirs is None


@pytest.mark.asyncio
async def test_a_warm_browser_with_other_logins_is_replaced_before_acting():
    runner, controller = Runner(), Controller(warm_with=[str(GITHUB), str(BITBUCKET)])
    service = BrowserProfilesService(
        browser_profiles_dao=DAO(),  # type: ignore[arg-type]
        runner_client=runner,  # type: ignore[arg-type]
        controller_client=controller,  # type: ignore[arg-type]
    )

    await service.run_tool(
        project_id=PROJECT,
        user_id=OWNER,
        session_id="sess-1",
        profile_ids=[GITHUB],
        is_draft=True,
        revision_author_id=None,
        op="navigate",
        args={"url": "https://github.com"},
    )

    # Only the caller's own browser of the session goes, never another user's.
    assert runner.deleted == [
        {
            "project_id": PROJECT,
            "scope": BrowserScope.SESSION,
            "ref": "sess-1",
            "label": f"user-{OWNER}",
        }
    ]
    assert len(runner.ensured) == 2
    assert controller.setups[0][2] == {str(GITHUB): 4}
    assert controller.logins == [[str(GITHUB)], [str(GITHUB)]]


@pytest.mark.asyncio
async def test_all_logins_reads_the_logins_at_each_call(monkeypatch):
    from oss.src.core.browser_profiles import handlers
    from oss.src.utils.env import env

    monkeypatch.setattr(env.browser, "enabled", True)
    listed = [PROFILES[GITHUB]]

    class ListingDAO(DAO):
        async def query_profiles(self, *, project_id, user_id):
            return listed

    controller = Controller()
    service = BrowserProfilesService(
        browser_profiles_dao=ListingDAO(),  # type: ignore[arg-type]
        runner_client=Runner(),  # type: ignore[arg-type]
        controller_client=controller,  # type: ignore[arg-type]
    )
    arguments = {
        "session_id": "s1",
        "profile_ids": [str(GITHUB)],
        "all_logins": True,
        "is_draft": True,
        "url": "https://bitbucket.org",
    }

    # A login added mid-turn (here Bitbucket) is used by the next call.
    listed.append(PROFILES[BITBUCKET])
    result = await handlers.handle_browser_tool(
        op="navigate",
        arguments=arguments,
        project_id=PROJECT,
        user_id=OWNER,
        browser_profiles_service=service,
    )

    assert result.content == "done"
    assert controller.logins[-1] == [str(GITHUB), str(BITBUCKET)]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "call_ref, intent",
    [
        ("tools.agenta.browser_pay", "pay"),
        ("tools.agenta.browser_delete", "delete"),
        ("tools.agenta.browser_click", None),
    ],
)
async def test_the_intent_comes_from_the_tool_never_the_model(
    monkeypatch, call_ref, intent
):
    from oss.src.core.browser_profiles import handlers
    from oss.src.utils.env import env

    monkeypatch.setattr(env.browser, "enabled", True)
    controller = Controller(warm_with=[str(GITHUB)])
    service = BrowserProfilesService(
        browser_profiles_dao=DAO(),  # type: ignore[arg-type]
        runner_client=Runner(),  # type: ignore[arg-type]
        controller_client=controller,  # type: ignore[arg-type]
    )

    await handlers.BROWSER_TOOL_HANDLERS[call_ref](
        arguments={
            "session_id": "s1",
            "profile_ids": [str(GITHUB)],
            "is_draft": True,
            "ref": "e1",
            # A model that claims approval for a plain click gets nothing from it.
            "intent": "delete",
        },
        project_id=PROJECT,
        user_id=OWNER,
        browser_profiles_service=service,
    )

    assert controller.args.get("intent") == intent
    assert controller.args["ref"] == "e1"
