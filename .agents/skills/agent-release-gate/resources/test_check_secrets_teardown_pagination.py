"""Unit test for the Daytona Secrets cursor enumeration (run: `pytest
test_check_secrets_teardown_pagination.py`, or `uv run --no-sync pytest` from `api/`).

The traps these pin, all found live against a ~3510-secret organization:

1. The listing is CURSOR-paginated at 100 per response. An unpaginated read sees only the first
   100 of ~3510, so the before/after set difference the cell is built on becomes noise in both
   directions: it invents leftovers and hides real ones at the same time.
2. A `page` parameter is SILENTLY IGNORED — the same 100 ids come back for every "page". Code
   written against `page` therefore loops forever on identical data while looking like it is
   making progress. The enumeration must notice a cursor that stops advancing.
3. A huge organization must not be able to hang the cell, so both a page ceiling and a
   wall-clock budget bound the walk. Hitting either is a SKIP, never a guess.

These use the `fetch` seam, so no request reaches Daytona and NO SECRET IS EVER CREATED, READ AT
VALUE, OR DELETED. Names and ids here are synthetic.
"""

import importlib
import sys
from pathlib import Path

import pytest


def _mod(monkeypatch):
    monkeypatch.setenv("AGENTA_BASE", "https://qa.example")
    monkeypatch.setenv("AGENTA_PROJECT_ID", "proj-1")
    monkeypatch.setenv("AGENTA_API_KEY", "test-key")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.modules.pop("qa_matrix_lib", None)
    sys.modules.pop("check_secrets_teardown", None)
    return importlib.import_module("check_secrets_teardown")


def _page(start: int, count: int, next_cursor):
    """One synthetic response page, in the shape `ListSecretsResponse` declares."""
    return {
        "items": [
            {"id": f"id-{i}", "name": f"agenta_{i:036x}_0"}
            for i in range(start, start + count)
        ],
        "total": 237,
        "nextCursor": next_cursor,
    }


def test_follows_the_cursor_to_exhaustion(monkeypatch):
    """Three pages (100, 100, 37) must yield all 237, not just the first 100."""
    m = _mod(monkeypatch)
    pages = {
        None: _page(0, 100, "cur-1"),
        "cur-1": _page(100, 100, "cur-2"),
        "cur-2": _page(200, 37, None),
    }
    asked = []

    def fetch(cursor):
        asked.append(cursor)
        return pages[cursor]

    out = m.list_secret_ids_by_name(fetch=fetch)
    assert len(out) == 237
    assert asked == [None, "cur-1", "cur-2"]
    assert out[f"agenta_{236:036x}_0"] == "id-236"


def test_stops_on_a_null_next_cursor(monkeypatch):
    m = _mod(monkeypatch)
    out = m.list_secret_ids_by_name(fetch=lambda cursor: _page(0, 4, None))
    assert len(out) == 4


def test_missing_next_cursor_field_terminates(monkeypatch):
    """An absent `nextCursor` must end the walk, not be read as 'keep going'."""
    m = _mod(monkeypatch)
    out = m.list_secret_ids_by_name(
        fetch=lambda cursor: {"items": [{"id": "id-0", "name": "agenta_x_0"}]}
    )
    assert out == {"agenta_x_0": "id-0"}


def test_a_repeating_cursor_is_refused_not_looped(monkeypatch):
    """The ignored-`page` shape: the same page forever. Must SKIP, not hang."""
    m = _mod(monkeypatch)
    calls = []

    def fetch(cursor):
        calls.append(cursor)
        return _page(0, 100, "same-cursor")

    with pytest.raises(m.SkipCheck) as e:
        m.list_secret_ids_by_name(fetch=fetch)
    assert "stopped advancing" in str(e.value)
    # It must give up almost immediately, not walk to the page ceiling.
    assert len(calls) == 2


def test_page_ceiling_is_a_skip_not_a_partial_answer(monkeypatch):
    """A cursor that advances forever must stop at the ceiling and refuse to answer."""
    m = _mod(monkeypatch)
    monkeypatch.setattr(m, "MAX_PAGES", 5)
    n = iter(range(10_000))

    def fetch(cursor):
        i = next(n)
        return _page(i * 100, 100, f"cur-{i}")

    with pytest.raises(m.SkipCheck) as e:
        m.list_secret_ids_by_name(fetch=fetch)
    assert "page ceiling" in str(e.value)


def test_time_budget_is_a_skip(monkeypatch):
    m = _mod(monkeypatch)
    monkeypatch.setattr(m, "MAX_ENUMERATION_SECONDS", -1.0)
    with pytest.raises(m.SkipCheck) as e:
        m.list_secret_ids_by_name(fetch=lambda cursor: _page(0, 1, "cur-1"))
    assert "exceeded" in str(e.value)


def test_a_malformed_payload_is_a_skip(monkeypatch):
    m = _mod(monkeypatch)
    with pytest.raises(m.SkipCheck):
        m.list_secret_ids_by_name(fetch=lambda cursor: {"items": "not-a-list"})


def test_only_this_runs_generated_names_are_treated_as_created(monkeypatch):
    """The name filter must accept the runner's generated shape and reject anything else."""
    m = _mod(monkeypatch)
    assert m.RUN_SECRET_NAME.match("agenta_" + "a" * 36 + "_0")
    assert m.RUN_SECRET_NAME.match("agenta_" + "0" * 36 + "_12")
    assert not m.RUN_SECRET_NAME.match("agenta_short_0")
    assert not m.RUN_SECRET_NAME.match("openai-key")
    assert not m.RUN_SECRET_NAME.match("agenta_" + "a" * 36)
