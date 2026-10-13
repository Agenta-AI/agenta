from datetime import datetime, timezone
from uuid import UUID

from oss.src.core.browser_profiles.dtos import BrowserProfile, BrowserProfileState
from oss.src.core.browser_profiles.session_state import (
    host_owner,
    merge_storage_states,
    rebase_share,
    session_label,
    split_storage_state,
    union_hosts,
)

GITHUB = UUID("00000000-0000-0000-0000-0000000000a1")
OTHER = UUID("00000000-0000-0000-0000-0000000000b2")
USER = UUID("00000000-0000-0000-0000-00000000000a")


def profile(id: UUID, hosts, updated: int) -> BrowserProfile:
    return BrowserProfile(
        id=id,
        name=str(id),
        allowed_hosts=hosts,
        state=BrowserProfileState.READY,
        generation=1,
        updated_at=datetime(2026, 10, updated, tzinfo=timezone.utc),
    )


def cookie(name: str, domain: str) -> dict:
    return {"name": name, "value": "v", "domain": domain, "path": "/"}


def origin(url: str) -> dict:
    return {"origin": url, "localStorage": [{"name": "k", "value": "v"}]}


# GitHub (newer) and a second login that also lists github.com.
NEWER = profile(GITHUB, ["github.com"], updated=9)
OLDER = profile(OTHER, ["bitbucket.org", "github.com"], updated=1)


def test_session_label_names_the_user():
    assert session_label(USER) == "user-00000000-0000-0000-0000-00000000000a"


def test_the_newest_login_owns_a_shared_host_and_subdomains():
    assert host_owner(".github.com", [OLDER, NEWER]) == GITHUB
    assert host_owner("gist.github.com", [OLDER, NEWER]) == GITHUB
    assert host_owner("bitbucket.org", [OLDER, NEWER]) == OTHER
    assert host_owner("example.com", [OLDER, NEWER]) is None


def test_merge_loads_only_what_each_login_owns():
    merged = merge_storage_states(
        {
            GITHUB: {
                "cookies": [cookie("gh_new", ".github.com")],
                "origins": [origin("https://github.com")],
            },
            OTHER: {
                "cookies": [
                    cookie("gh_old", "github.com"),
                    cookie("bb", ".bitbucket.org"),
                    cookie("stray", "example.com"),
                ],
                "origins": [origin("https://bitbucket.org")],
            },
        },
        [NEWER, OLDER],
    )
    assert sorted(c["name"] for c in merged["cookies"]) == ["bb", "gh_new"]
    assert sorted(o["origin"] for o in merged["origins"]) == [
        "https://bitbucket.org",
        "https://github.com",
    ]


def test_split_returns_each_share_and_drops_the_rest():
    shares = split_storage_state(
        {
            "cookies": [
                cookie("gh", ".github.com"),
                cookie("bb", "bitbucket.org"),
                cookie("cdn", "cdn.example.net"),
            ],
            "origins": [origin("https://github.com"), origin("https://x.example.net")],
        },
        [OLDER, NEWER],
    )
    assert [c["name"] for c in shares[GITHUB]["cookies"]] == ["gh"]
    assert [c["name"] for c in shares[OTHER]["cookies"]] == ["bb"]
    assert [o["origin"] for o in shares[GITHUB]["origins"]] == ["https://github.com"]
    assert shares[OTHER]["origins"] == []


def test_split_of_nothing_gives_empty_shares():
    assert split_storage_state(None, [NEWER]) == {
        GITHUB: {"cookies": [], "origins": []}
    }


def test_union_hosts():
    assert union_hosts([NEWER, OLDER]) == ["bitbucket.org", "github.com"]


def test_a_save_keeps_what_an_older_login_had_for_a_host_it_lost():
    stored = {
        "cookies": [cookie("gh_old", "github.com"), cookie("bb_old", "bitbucket.org")],
        "origins": [origin("https://github.com")],
    }
    share = {"cookies": [cookie("bb_new", "bitbucket.org")], "origins": []}

    saved = rebase_share(stored, share, OTHER, [NEWER, OLDER])

    assert [c["name"] for c in saved["cookies"]] == ["gh_old", "bb_new"]
    assert [o["origin"] for o in saved["origins"]] == ["https://github.com"]


INSTAGRAM = profile(GITHUB, ["www.instagram.com"], updated=5)
CODECOV = profile(OTHER, ["app.codecov.io"], updated=5)


def test_a_www_site_covers_the_site_itself():
    assert host_owner("instagram.com", [INSTAGRAM]) == GITHUB
    assert host_owner("www.instagram.com", [INSTAGRAM]) == GITHUB
    assert union_hosts([INSTAGRAM]) == ["instagram.com"]


def test_a_cookie_on_a_parent_domain_belongs_to_the_login():
    assert host_owner(".instagram.com", [INSTAGRAM], cookie=True) == GITHUB
    assert host_owner(".codecov.io", [CODECOV], cookie=True) == OTHER
    # A page on the parent domain is not one of the login's sites.
    assert host_owner("codecov.io", [CODECOV]) is None


def test_parent_domain_cookies_survive_a_merge_and_a_split():
    state = {"cookies": [cookie("sessionid", ".instagram.com")], "origins": []}
    merged = merge_storage_states({GITHUB: state}, [INSTAGRAM])
    assert [c["name"] for c in merged["cookies"]] == ["sessionid"]
    shares = split_storage_state(merged, [INSTAGRAM])
    assert [c["name"] for c in shares[GITHUB]["cookies"]] == ["sessionid"]
