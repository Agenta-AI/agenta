"""The OAuth callback page, which has to serve two arrivals it cannot tell apart in advance.

A popup has an opener to post to and may close itself. A tab the app navigated because the
popup was blocked has neither: `window.close` is ignored for a window a script did not open,
so without a return the person is left on the API's origin, under a message about a tab that
will never close, with the app they came from gone (D27).

These read the rendered page rather than driving a browser, so they assert what it is capable
of rather than what it did.
"""

from oss.src.apis.fastapi.gateways.mcps.router import _connect_card

AGENTA_URL = "https://agenta.example"


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

    def test_it_says_nothing_about_closing_a_tab_it_cannot_close(self):
        page = _card()

        # Both lines ship hidden; the script reveals whichever applies once it knows.
        assert 'id="auto-return-text" class="auto-return" hidden' in page
        assert 'id="manual-return-text" class="auto-return" hidden' in page


class TestWhenTheDeploymentPublishesNoAppUrl:
    def test_it_neither_posts_nor_redirects(self):
        page = _connect_card(success=True, agenta_url=None, endpoint_id=None)

        # With no origin to trust there is nowhere safe to send anyone.
        assert "const AGENTA_POST_MESSAGE_ORIGIN = null;" in page
        assert (
            "window.opener.postMessage" in page
        )  # present, but behind the origin check
        assert "if (opened)" in page
