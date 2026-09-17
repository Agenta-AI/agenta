"""The OAuth callback page, which has to serve two arrivals it cannot tell apart in advance.

A popup has an opener to post to and may close itself. A tab the app navigated because the
popup was blocked has neither: `window.close` is ignored for a window a script did not open,
so without a return the person is left on the API's origin, under a message about a tab that
will never close, with the app they came from gone (D27).

These read the rendered page rather than driving a browser, so they assert what it is capable
of rather than what it did.
"""

import pytest

from oss.src.apis.fastapi.gateways.mcps.router import _connect_card

AGENTA_URL = "https://agenta.example"

_APP_ORIGINS = "oss.src.apis.fastapi.gateways.mcps.router.env.agenta.app_origins"


@pytest.fixture(autouse=True)
def _declare_no_app_origins(monkeypatch):
    """Every case below states its own deployment, rather than inheriting the shell's.

    `_connect_card` reads `_app_origins(agenta_url)`, whose candidates are
    `[agenta_url, *env.agenta.app_origins]`. Nothing here cleared the second half, so the
    case that asserts "a deployment publishing no app address sends nobody anywhere" only
    asserted that while the ambient environment happened to declare none. Run the suite the
    way `AGENTS.md` prescribes — `load-env hosting/docker-compose/ee/.env.ee.dev` first — and
    it failed on a candidate with no defect in it; run it against any real deployment, which
    declares origins, and the property had no coverage at all. D71 introduced
    `_app_origins` and is exactly the change that could break it (D95).

    Empty is the default because it is the case the file is mostly about. A case that means
    to test a deployment with declared origins sets them itself.
    """
    monkeypatch.setattr(_APP_ORIGINS, [])


def _card(**overrides) -> str:
    return _connect_card(
        **{
            "success": True,
            "agenta_url": AGENTA_URL,
            "endpoint_id": "01a0a000-0000-7000-8000-000000000001",
            **overrides,
        }
    )


class TestThePopupPath:
    def test_it_posts_the_completion_to_the_opener(self):
        page = _card()

        assert "window.opener.postMessage(AGENTA_OAUTH_COMPLETE" in page
        assert "mcp:oauth:connected" in page

    def test_it_closes_itself_only_when_it_was_opened_by_a_script(self):
        page = _card()

        # The close is inside the branch that found an opener, never at the top level.
        opener_branch = page.split("if (opened)")[1].split("} else if")[0]
        assert "window.close()" in opener_branch
        assert "window.close()" not in page.split("} else if")[1]


class TestTheBlockedPopupPath:
    def test_it_sends_a_tab_with_no_opener_back_to_the_app(self):
        page = _card()

        fallback = page.split("} else if")[1]
        assert "window.location.replace" in fallback
        assert "AGENTA_RETURN_PATH" in fallback

    def test_it_returns_to_the_app_origin_and_not_the_api(self):
        page = _card()

        assert f'"{AGENTA_URL}"' in page
        assert '"/settings?tab=mcpEndpoints"' in page

    def test_it_returns_after_a_failure_too_rather_than_stranding_the_tab(self):
        page = _card(success=False, error="The authorization was declined.")

        # A refusal is where someone most needs the way back.
        assert "window.location.replace" in page
        assert "The authorization was declined." in page

    def test_it_prefers_the_page_the_tab_was_actually_on(self):
        page = _card()

        fallback = page.split("} else if")[1]
        # This page knows the deployment's origin and nothing else: not the surface, not the
        # workspace, not the project. The tab wrote its own path down before navigating away,
        # and that is what it comes back to (UI QA round 3, D1).
        assert "sessionStorage.getItem(AGENTA_RETURN_PATH_KEY)" in fallback
        assert '"agenta:mcp:return-path"' in page
        assert (
            "window.location.replace(AGENTA_POST_MESSAGE_ORIGIN + target)" in fallback
        )

    def test_it_refuses_a_remembered_value_that_names_another_origin(self):
        page = _card()

        fallback = page.split("} else if")[1]
        # The value is joined to an origin, so "//evil.test" would be a URL to somewhere else.
        # Path-only, one leading slash, no backslashes, and a length that cannot be a payload.
        assert 'remembered.charAt(0) === "/"' in fallback
        assert 'remembered.charAt(1) !== "/"' in fallback
        assert "remembered.indexOf(BACKSLASH) === -1" in fallback
        assert "remembered.length <= 2048" in fallback

    def test_its_script_carries_no_backslash_it_could_choke_on(self):
        page = _card()
        script = page.split("<script>")[1].split("</script>")[0]

        # This whole script is a Python template, so a backslash written into it arrives one
        # escaping layer short: the check that refused a remembered path containing one ended
        # up as a lone backslash before a quote, which swallowed it. The script stopped
        # parsing, so NOTHING in it ran, no message to the opener, no return and no close, and
        # the popup sat on a success card while the dialog behind it waited forever. The test
        # that stood here asserted the hazard was PRESENT, and passed while it broke the flow.
        assert chr(92) not in script

    def test_it_forgets_the_path_once_it_has_used_it(self):
        page = _card()

        # A stale path would send the NEXT blocked-popup return to wherever the last one began.
        assert "sessionStorage.removeItem(AGENTA_RETURN_PATH_KEY)" in page

    def test_it_still_has_a_path_when_nothing_was_remembered(self):
        page = _card()

        fallback = page.split("} else if")[1]
        # Cross-origin deployments share no storage with this page, so the fallback is the
        # only thing that runs there.
        assert "let target = AGENTA_RETURN_PATH;" in fallback

    def test_it_says_nothing_about_closing_a_tab_it_cannot_close(self):
        page = _card()

        # Both lines ship hidden; the script reveals whichever applies once it knows.
        assert 'id="auto-return-text" class="auto-return" hidden' in page
        assert 'id="manual-return-text" class="auto-return" hidden' in page


class TestWhenTheDeploymentPublishesNoAppUrl:
    """ "No app URL" is about the whole deployment, not about one argument.

    The guard is that `_app_origins` returns nothing, and `agenta_url=None` is only half of
    what decides that. The API's own origin is deliberately not offered — it is where this
    page is served from, not where the app is — so a deployment that declares nothing really
    does send nobody anywhere, and one that declares an origin elsewhere still has somewhere
    to post to even with no configured `agenta_url`.
    """

    def test_it_neither_posts_nor_redirects(self):
        page = _connect_card(success=True, agenta_url=None, endpoint_id=None)

        # With no origin to trust there is nowhere safe to send anyone.
        assert "const AGENTA_POST_MESSAGE_ORIGIN = null;" in page
        assert "const AGENTA_APP_ORIGINS = [];" in page
        assert (
            "window.opener.postMessage" in page
        )  # present, but behind the origin check
        assert "if (opened)" in page

    def test_a_declared_origin_is_still_somewhere_to_post_to(self, monkeypatch):
        """The half the old case could not tell apart from its own, because it inherited it.

        No `agenta_url` and a declared origin is the ordinary shape of a deployment reached
        through a tunnel, and the completion has to reach it.
        """
        monkeypatch.setattr(_APP_ORIGINS, ["http://localhost:8680"])

        page = _connect_card(success=True, agenta_url=None, endpoint_id=None)

        assert 'const AGENTA_POST_MESSAGE_ORIGIN = "http://localhost:8680";' in page
        assert "AGENTA_APP_ORIGINS.forEach" in page

    def test_the_stranded_tab_is_not_sent_anywhere_either(self):
        """The other half of "neither posts nor redirects", which the old case named and
        never asserted.

        A tab with no opener is normally navigated back to the app. With no origin to trust
        there is nowhere to navigate it to, so the branch that would is closed rather than
        joining a path to whatever address the browser used to reach this page.
        """
        page = _connect_card(success=True, agenta_url=None, endpoint_id=None)

        # The redirect lives behind the same origin check the post does.
        assert "}} else if (AGENTA_POST_MESSAGE_ORIGIN) {{" not in page
        assert "} else if (AGENTA_POST_MESSAGE_ORIGIN) {" in page
        redirect_branch = page.split("} else if (AGENTA_POST_MESSAGE_ORIGIN) {")[1]
        assert "window.location.replace" in redirect_branch


# ---------------------------------------------------------------------------
# D71: a deployment served at more than one address
# ---------------------------------------------------------------------------


class TestEveryAppOriginTheDeploymentDeclares:
    """`postMessage` delivers nothing unless its target names the opener's exact origin.
    With one configured address, everyone reaching the app at any other one had the
    consent result delivered nowhere: the dialog waited out its timeout while the
    connection sat authorized behind it."""

    def test_a_second_declared_origin_is_offered_too(self, monkeypatch):
        monkeypatch.setattr(
            "oss.src.apis.fastapi.gateways.mcps.router.env.agenta.app_origins",
            ["http://localhost:8680"],
        )

        page = _card()

        assert AGENTA_URL in page
        assert "http://localhost:8680" in page
        # Posted once per origin, each still naming its target exactly.
        assert "AGENTA_APP_ORIGINS.forEach" in page
        assert "window.opener.postMessage(AGENTA_OAUTH_COMPLETE, origin)" in page

    def test_the_configured_app_address_still_comes_first(self, monkeypatch):
        """The others are additions, not replacements: the tab-return fallback sends one
        person to one place, and that stays the address the deployment publishes."""
        monkeypatch.setattr(
            "oss.src.apis.fastapi.gateways.mcps.router.env.agenta.app_origins",
            ["http://localhost:8680"],
        )

        page = _card()

        assert f'const AGENTA_POST_MESSAGE_ORIGIN = "{AGENTA_URL}";' in page

    def test_an_origin_is_never_offered_twice(self, monkeypatch):
        monkeypatch.setattr(
            "oss.src.apis.fastapi.gateways.mcps.router.env.agenta.app_origins",
            [AGENTA_URL, f"{AGENTA_URL}/w/ws-1"],
        )

        page = _card()

        offered = page.split("const AGENTA_APP_ORIGINS = ")[1].split(";")[0]
        assert offered.count(AGENTA_URL) == 1, offered

    def test_a_declared_origin_is_reduced_to_an_origin(self, monkeypatch):
        """A path on a declared address would make every post target a string no window
        ever has, which is the failure this exists to remove rather than repeat."""
        monkeypatch.setattr(
            "oss.src.apis.fastapi.gateways.mcps.router.env.agenta.app_origins",
            ["http://localhost:8680/settings?tab=mcpEndpoints"],
        )

        page = _card()
        offered = page.split("const AGENTA_APP_ORIGINS = ")[1].split(";")[0]

        assert "http://localhost:8680" in offered
        assert "settings" not in offered

    def test_nonsense_among_the_declared_origins_is_dropped(self, monkeypatch):
        monkeypatch.setattr(
            "oss.src.apis.fastapi.gateways.mcps.router.env.agenta.app_origins",
            ["not-a-url", "", "http://localhost:8680"],
        )

        page = _card()
        offered = page.split("const AGENTA_APP_ORIGINS = ")[1].split(";")[0]

        assert "not-a-url" not in offered
        assert "http://localhost:8680" in offered

    def test_a_deployment_that_declares_nothing_is_unchanged(self, monkeypatch):
        monkeypatch.setattr(
            "oss.src.apis.fastapi.gateways.mcps.router.env.agenta.app_origins", []
        )

        page = _card()
        offered = page.split("const AGENTA_APP_ORIGINS = ")[1].split(";")[0]

        assert offered == f'["{AGENTA_URL}"]'
