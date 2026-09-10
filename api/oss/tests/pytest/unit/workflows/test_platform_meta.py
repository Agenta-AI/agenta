"""The backend-owned `meta._ag` namespace guard (plan-meta-provenance.md, decision 2).

Mahmoud's review requirement: generic workflow and skill edits cannot
overwrite or remove `meta._ag`, while trusted backend import/update code can
change the permitted fields. The git DAO applies `guard_platform_meta` at
every meta write point, so these rules hold for every git entity and route.
"""

from oss.src.core.git.platform_meta import guard_platform_meta

ORIGIN = {"origin": {"provider": "github", "locator": {"path": "skills/x"}}}
STORED = {"user_note": "keep", "_ag": ORIGIN}


# --- the EDIT rule: existing _ag survives every untrusted shape -----------------


def test_edit_cannot_remove_ag_by_omitting_it():
    result = guard_platform_meta(
        {"user_note": "new"}, STORED, trusted=False, preserve=True
    )
    assert result == {"user_note": "new", "_ag": ORIGIN}


def test_edit_cannot_remove_ag_by_clearing_meta():
    result = guard_platform_meta(None, STORED, trusted=False, preserve=True)
    assert result == {"_ag": ORIGIN}


def test_edit_cannot_replace_ag_with_a_forged_value():
    forged = {"user_note": "new", "_ag": {"origin": {"provider": "evil"}}}
    result = guard_platform_meta(forged, STORED, trusted=False, preserve=True)
    assert result == {"user_note": "new", "_ag": ORIGIN}


def test_edit_without_stored_ag_stays_clientowned():
    result = guard_platform_meta(
        {"user_note": "new"}, {"user_note": "old"}, trusted=False, preserve=True
    )
    assert result == {"user_note": "new"}


def test_edit_cannot_introduce_ag_on_a_clean_record():
    forged = {"_ag": {"origin": {"provider": "evil"}}}
    result = guard_platform_meta(forged, None, trusted=False, preserve=True)
    assert result == {}


# --- the CREATE/COMMIT rule: incoming _ag is stripped ---------------------------


def test_create_strips_forged_ag():
    forged = {"user_note": "x", "_ag": {"origin": {"provider": "evil"}}}
    result = guard_platform_meta(forged, None, trusted=False, preserve=False)
    assert result == {"user_note": "x"}


def test_commit_does_not_inherit_ag_from_anywhere():
    # A local-edit commit stays UNSTAMPED — derived detachment depends on it.
    result = guard_platform_meta(
        {"note": "local edit"}, STORED, trusted=False, preserve=False
    )
    assert result == {"note": "local edit"}


def test_create_with_no_meta_stays_none():
    assert guard_platform_meta(None, None, trusted=False, preserve=False) is None


# --- the trusted escape ---------------------------------------------------------


def test_trusted_write_passes_through_unchanged():
    incoming = {"user_note": "kept", "_ag": {"origin": {"provider": "github"}}}
    assert (
        guard_platform_meta(incoming, STORED, trusted=True, preserve=True) is incoming
    )
    assert guard_platform_meta(incoming, None, trusted=True, preserve=False) is incoming
