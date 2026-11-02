"""The server half of the folder rule.

Until these tokens existed, "the app may only touch its own folder" was enforced in one place:
the browser tab. A bug there reached the whole mount, and there was one — markup references
skipped the path check entirely. These tests are the second line.

Everything here is about a token NARROWING. It can never grant access the caller lacks, so the
interesting cases are all refusals: a forged signature, an expired token, one minted for a
different drive, a write under a read grant, and a path that climbs out of the folder.
"""

import time
from uuid import uuid4

import pytest

from oss.src.core.apps.scope_token import (
    AppScope,
    ScopeTokenInvalid,
    enforce,
    mint,
    parse,
)

PROJECT = uuid4()
MOUNT = uuid4()
DIR = "apps/launch-board"


def _token(**kw):
    params = dict(project_id=PROJECT, mount_id=MOUNT, prefix=DIR, level="read-write")
    params.update(kw)
    return mint(**params)[0]


class TestMint:
    def test_round_trips_its_claims(self):
        scope = parse(_token())
        assert scope.project_id == str(PROJECT)
        assert scope.mount_id == str(MOUNT)
        assert scope.prefix == DIR
        assert scope.level == "read-write"
        assert scope.expires_at > int(time.time())

    def test_normalises_the_folder(self):
        assert parse(_token(prefix="/apps/launch-board/")).prefix == DIR

    def test_refuses_to_scope_the_whole_mount(self):
        # An empty prefix would be a token that permits everything, which is the thing this
        # module exists to prevent. Better to fail at mint than to issue it.
        for empty in ("", "/", "   "):
            with pytest.raises(ScopeTokenInvalid):
                mint(project_id=PROJECT, mount_id=MOUNT, prefix=empty, level="read")

    def test_refuses_an_unknown_level(self):
        with pytest.raises(ScopeTokenInvalid):
            mint(project_id=PROJECT, mount_id=MOUNT, prefix=DIR, level="admin")


class TestParse:
    def test_rejects_an_upgraded_payload(self):
        # The attack the signature exists for: take a read token and paste a read-write body
        # under its signature.
        _, read_sig = _token(level="read").split(".")
        write_body, _ = _token(level="read-write").split(".")
        with pytest.raises(ScopeTokenInvalid):
            parse(f"{write_body}.{read_sig}")

    def test_rejects_a_bad_signature(self):
        body, _ = _token().split(".")
        with pytest.raises(ScopeTokenInvalid):
            parse(f"{body}.not-a-signature")

    def test_rejects_malformed_input(self):
        for bad in ("", "nodot", "a.b.c", "!!!.!!!"):
            with pytest.raises(ScopeTokenInvalid):
                parse(bad)

    def test_rejects_an_expired_token(self):
        token = _token()
        expired, _ = mint(
            project_id=PROJECT, mount_id=MOUNT, prefix=DIR, level="read", ttl_seconds=-1
        )
        assert parse(token)  # the control still parses
        with pytest.raises(ScopeTokenInvalid):
            parse(expired)


class TestAllowsPath:
    @pytest.mark.parametrize(
        "path",
        [DIR, f"{DIR}/board.json", f"{DIR}/nested/deep.json", f"/{DIR}/board.json"],
    )
    def test_inside(self, path):
        assert parse(_token()).allows_path(path)

    @pytest.mark.parametrize(
        "path",
        [
            "secrets.json",
            "apps/other-board/board.json",
            # The prefix is a path segment, not a string prefix: a sibling folder whose name
            # starts with the same characters is still outside.
            "apps/launch-board-2/board.json",
            "apps",
            "",
        ],
    )
    def test_outside(self, path):
        assert not parse(_token()).allows_path(path)


class TestEnforce:
    def test_no_token_means_no_narrowing(self):
        # The drive's own UI sends none, and must keep working exactly as before.
        enforce(
            token=None,
            project_id=PROJECT,
            mount_id=MOUNT,
            path="anything/at/all.json",
            writing=True,
        )

    def test_allows_a_path_inside_the_folder(self):
        enforce(
            token=_token(),
            project_id=PROJECT,
            mount_id=MOUNT,
            path=f"{DIR}/board.json",
            writing=True,
        )

    def test_refuses_a_path_outside_the_folder(self):
        # The case that was live: markup climbing out of the app dir.
        with pytest.raises(ScopeTokenInvalid):
            enforce(
                token=_token(),
                project_id=PROJECT,
                mount_id=MOUNT,
                path="secrets.json",
                writing=False,
            )

    def test_refuses_a_write_under_a_read_token(self):
        with pytest.raises(ScopeTokenInvalid):
            enforce(
                token=_token(level="read"),
                project_id=PROJECT,
                mount_id=MOUNT,
                path=f"{DIR}/board.json",
                writing=True,
            )

    def test_allows_a_read_under_a_read_token(self):
        enforce(
            token=_token(level="read"),
            project_id=PROJECT,
            mount_id=MOUNT,
            path=f"{DIR}/board.json",
            writing=False,
        )

    def test_refuses_a_token_minted_for_another_mount(self):
        with pytest.raises(ScopeTokenInvalid):
            enforce(
                token=_token(),
                project_id=PROJECT,
                mount_id=uuid4(),
                path=f"{DIR}/board.json",
                writing=False,
            )

    def test_refuses_a_token_minted_for_another_project(self):
        with pytest.raises(ScopeTokenInvalid):
            enforce(
                token=_token(),
                project_id=uuid4(),
                mount_id=MOUNT,
                path=f"{DIR}/board.json",
                writing=False,
            )

    def test_a_pathless_call_still_checks_drive_and_level(self):
        # The drive and level still have to match when no path is named.
        enforce(
            token=_token(), project_id=PROJECT, mount_id=MOUNT, path=None, writing=False
        )
        with pytest.raises(ScopeTokenInvalid):
            enforce(
                token=_token(),
                project_id=PROJECT,
                mount_id=uuid4(),
                path=None,
                writing=False,
            )

    def test_a_pathless_scoped_call_is_narrowed_to_the_folder(self):
        # A token must never widen a request. `path=None` used to skip the prefix check and let
        # the caller list the whole mount, so the scoped page could read every file on the drive.
        assert (
            enforce(
                token=_token(),
                project_id=PROJECT,
                mount_id=MOUNT,
                path=None,
                writing=False,
            )
            == DIR
        )

    def test_a_named_path_inside_the_folder_is_returned_unchanged(self):
        inside = f"{DIR}/board.json"
        assert (
            enforce(
                token=_token(),
                project_id=PROJECT,
                mount_id=MOUNT,
                path=inside,
                writing=False,
            )
            == inside
        )

    def test_an_unscoped_call_keeps_whatever_path_it_asked_for(self):
        # No token, no narrowing: the project permission check is what stands behind these.
        assert (
            enforce(
                token=None, project_id=PROJECT, mount_id=MOUNT, path=None, writing=False
            )
            is None
        )
        assert (
            enforce(
                token=None,
                project_id=PROJECT,
                mount_id=MOUNT,
                path="somewhere/else",
                writing=False,
            )
            == "somewhere/else"
        )


class TestAppScope:
    def test_an_empty_prefix_allows_nothing(self):
        # Defensive: `mint` refuses to make one, so this can only arrive hand-built. It must
        # fail closed rather than read as "the whole mount".
        scope = AppScope(
            project_id=str(PROJECT),
            mount_id=str(MOUNT),
            prefix="",
            level="read-write",
            expires_at=int(time.time()) + 60,
        )
        assert not scope.allows_path("anything.json")
