# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6", "pytest>=8"]
# ///
"""Plumbing tests for the orchestration console store.

Run:  uv run test_console.py        (self-invokes pytest)
"""

from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from console_store import (  # noqa: E402
    Store,
    parse_doc,
    render_doc,
    parse_messages,
    _replace_section,
    _append_to_section,
)


@pytest.fixture
def store(tmp_path):
    s = Store(tmp_path)
    s.project_new("demo", "Demo project", "Prove the loop works")
    return s


def test_frontmatter_roundtrip():
    meta = {"id": "x", "status": "open", "n": 3}
    body = "# Hi\n\nsome **body**"
    meta2, body2 = parse_doc(render_doc(meta, body))
    assert meta2 == meta
    assert body2.strip() == body.strip()


def test_project_created(store, tmp_path):
    assert (tmp_path / "demo" / "project.md").exists()
    projects = store.list_projects()
    assert projects[0]["id"] == "demo"
    assert projects[0]["status"] == "active"


def test_task_lifecycle(store):
    store.task_add("demo", "t1", "Build the store", owner="impl-agent")
    m = store.task_set("demo", "t1", status="running")
    assert m["status"] == "running"
    m = store.task_set("demo", "t1", status="in-review", pr="#123", note="opened PR")
    assert m["status"] == "in-review"
    assert m["pr"] == "#123"
    tasks = store.load_tasks("demo")
    assert tasks[0][0]["id"] == "t1"
    # the note landed in the body History
    assert "opened PR" in tasks[0][1]


def test_bad_status_rejected(store):
    store.task_add("demo", "t1", "x")
    with pytest.raises(ValueError):
        store.task_set("demo", "t1", status="bogus")


def test_decision_state_machine(store):
    store.decision_add(
        "demo",
        "d1",
        "Which route?",
        "take route A",
        context="two routes",
        options=["(a) route A", "(b) route B"],
    )
    d = store.load_decisions("demo")[0][0]
    assert d["status"] == "open"
    # UI writeback: open -> answered, records answer + provenance
    d = store.decision_answer("demo", "d1", "go with A", by="user")
    assert d["status"] == "answered"
    assert d["answer"] == "go with A"
    assert d["answered_by"] == "user"
    # answered shows up in pending
    pending = store.read_pending("demo")
    assert [x["id"] for x in pending["answered_decisions"]] == ["d1"]
    # agent locks: answered -> locked, no longer pending
    d = store.decision_lock("demo", "d1", outcome="implemented in t1")
    assert d["status"] == "locked"
    assert store.read_pending("demo")["answered_decisions"] == []
    # body carries the locked answer
    body = store.load_decisions("demo")[0][1]
    assert "Locked" in body and "go with A" in body and "implemented in t1" in body


def test_ui_cannot_lock(store):
    """The UI writeback path never locks; only the agent lock() does."""
    store.decision_add("demo", "d1", "q", "rec")
    store.decision_answer("demo", "d1", "ans")
    # a second answer is fine (still answered), but there is no answer() path to 'locked'
    d = store.decision_answer("demo", "d1", "revised ans")
    assert d["status"] == "answered"
    # once locked, the UI answer path refuses
    store.decision_lock("demo", "d1")
    with pytest.raises(ValueError):
        store.decision_answer("demo", "d1", "too late")


def test_notes_pending_and_ack(store):
    store.note_add("demo", "please prioritise the web app", by="user")
    pending = store.read_pending("demo")
    assert len(pending["notes"]) == 1
    nid = store.load_notes("demo")[0][0]["id"]
    store.note_ack("demo", nid)
    assert store.read_pending("demo")["notes"] == []


def test_feed_seq_monotonic(store):
    for i in range(5):
        store.message("demo", f"msg {i}")
    feed = store.read_feed("demo")
    seqs = [e["seq"] for e in feed]
    assert seqs == sorted(seqs)
    assert len(set(seqs)) == len(seqs)  # unique


def test_feed_seq_no_collision_under_concurrency(store):
    def emit(i):
        store.message("demo", f"concurrent {i}")

    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(emit, range(40)))
    feed = store.read_feed("demo")
    seqs = [e["seq"] for e in feed if e["text"].startswith("concurrent")]
    assert len(seqs) == 40
    assert len(set(seqs)) == 40  # the flock guarantees no duplicate seq


def test_feed_since(store):
    store.message("demo", "a")
    store.message("demo", "b")
    last = store.read_feed("demo")[-1]["seq"]
    store.message("demo", "c")
    fresh = store.read_feed("demo", since=last)
    assert [e["text"] for e in fresh] == ["c"]


def test_task_no_placeholder_prose(store):
    """The scaffold must not emit fake placeholder prose (the artifact Mahmoud found)."""
    store.task_add("demo", "t1", "Build a thing")
    body = store.load_tasks("demo")[0][1]
    assert "What this task is and why" not in body
    assert "Key facts a reviewer needs" not in body
    assert "## Messages" in body


def test_task_context_and_user_message(store):
    store.task_add("demo", "t1", "Build a thing", context="real context here")
    body = store.load_tasks("demo")[0][1]
    assert "real context here" in body
    # user posts a message to the task -> flags it for the agent
    m = store.task_message("demo", "t1", "please also handle retries", by="user")
    assert m["needs_reply"] is True
    assert m["id"] in [t["id"] for t in store.read_pending("demo")["tasks"]]
    # agent replies via task_set note -> clears the flag, lands in Messages
    m = store.task_set("demo", "t1", note="added retries")
    assert m["needs_reply"] is False
    assert store.read_pending("demo")["tasks"] == []
    body = store.load_tasks("demo")[0][1]
    assert "please also handle retries" in body and "added retries" in body


def test_thread_state_machine(store):
    # agent-opened thread starts as its turn (investigating)
    store.thread_new("demo", "th1", "How should we shard?", summary="undecided")
    t = store.load_threads("demo")[0][0]
    assert t["status"] == "investigating" and t["needs_reply"] is False
    # user posts -> still the agent's turn (investigating) + flagged unread
    store.thread_message("demo", "th1", "can we shard by tenant?", by="user")
    t = store.load_threads("demo")[0][0]
    assert t["status"] == "investigating" and t["needs_reply"] is True
    pend = store.read_pending("demo")["threads"]
    assert (
        pend and pend[0]["id"] == "th1" and "shard by tenant" in pend[0]["last_message"]
    )
    # agent replies -> default hands the ball back to the user (waiting), clears unread
    store.thread_reply(
        "demo", "th1", "yes, by tenant", summary="Decision: shard by tenant."
    )
    t, body = store.load_threads("demo")[0]
    assert t["status"] == "waiting" and t["needs_reply"] is False
    assert "Decision: shard by tenant." in body
    assert store.read_pending("demo")["threads"] == []
    # agent can also reply and keep working, or resolve
    store.thread_reply("demo", "th1", "one more check", status="investigating")
    assert store.load_threads("demo")[0][0]["status"] == "investigating"
    store.thread_set("demo", "th1", status="resolved")
    assert store.load_threads("demo")[0][0]["status"] == "resolved"


def test_user_opened_thread_waits_on_agent(store):
    store.thread_new("demo", "q1", "A question", first_message="what is X?", by="user")
    t = store.load_threads("demo")[0][0]
    assert t["status"] == "investigating" and t["needs_reply"] is True
    assert store.read_pending("demo")["threads"][0]["id"] == "q1"


def test_messages_render_as_readable_blocks(store):
    store.thread_new("demo", "th1", "Topic", first_message="first thing", by="user")
    store.thread_reply("demo", "th1", "here is a **markdown** reply\n\n- a\n- b")
    body = store.load_threads("demo")[0][1]
    # sender + short-time headers, not cramped "- ts **who:**" bullets
    assert "**You** ·" in body and "**Agent** ·" in body
    assert "- 2026-" not in body  # the old bullet format is gone
    # the reply's own markdown is preserved for rendering
    assert "**markdown**" in body and "- a" in body


def test_backlog_from_thread(store):
    store.thread_new(
        "demo", "tg", "Telegram trigger?", summary="No incoming trigger in Composio."
    )
    item = store.backlog_from_thread("demo", "tg", kind="task")
    assert item["kind"] == "task" and item["source_project"] == "demo"
    ids = [m["id"] for m, _ in store.load_backlog()]
    assert item["id"] in ids
    _, body = [x for x in store.load_backlog() if x[0]["id"] == item["id"]][0]
    assert "No incoming trigger in Composio." in body  # summary carried across
    assert "/p/demo#thread-tg" in body  # link back to the source thread


def test_backlog_add_and_set(store):
    store.backlog_add(
        "b1",
        "Research X",
        note="why it matters",
        kind="task",
        links=[{"label": "doc", "href": "findings/x.md"}],
    )
    m, body = store.load_backlog()[0]
    assert m["title"] == "Research X" and "findings/x.md" in body
    store.backlog_set("b1", status="done")
    assert store.load_backlog()[0][0]["status"] == "done"


def test_backlog_not_a_project(store):
    # the _backlog dir must not show up as a project
    store.backlog_add("b1", "x")
    assert "_backlog" not in [p["id"] for p in store.list_projects()]


def test_thread_promote_to_task(store):
    store.thread_new(
        "demo", "th1", "Investigate caching", summary="Cache the hot path."
    )
    store.thread_promote("demo", "th1", "caching-task")
    t = store.load_threads("demo")[0][0]
    assert t["status"] == "promoted" and t["promoted_to"] == "caching-task"
    # the new task exists and carried the summary across as its Context
    task_meta, task_body = store.load_tasks("demo")[0]
    assert task_meta["id"] == "caching-task"
    assert "Cache the hot path." in task_body


def test_thread_code_and_resolve_by_code(store):
    store.thread_new("demo", "telegram-trigger", "Telegram trigger question")
    m = store.load_threads("demo")[0][0]
    assert m["code"].startswith("TEL-")  # 3 letters from the title + a number
    # a second thread gets a distinct number
    store.thread_new("demo", "sharding", "Sharding strategy")
    codes = {x[0]["code"] for x in store.load_threads("demo")}
    assert len(codes) == 2
    # mutations accept the short code (case-insensitive), not just the id
    store.thread_message("demo", m["code"].lower(), "hi", by="user")
    tt = [x[0] for x in store.load_threads("demo") if x[0]["id"] == "telegram-trigger"][
        0
    ]
    assert tt["needs_reply"] is True


def test_parse_messages_splits_blocks():
    section = "**You** · Jul 1, 13:54\n\nhello there\n\n**Agent** · Jul 1, 14:00\n\nline1\nline2"
    ms = parse_messages(section)
    assert len(ms) == 2
    assert ms[0]["who"] == "You" and ms[0]["text"] == "hello there"
    assert ms[1]["who"] == "Agent" and ms[1]["text"] == "line1\nline2"


def test_hide_and_unhide_thread_and_task(store):
    store.thread_new("demo", "t1", "A thread")
    store.task_add("demo", "k1", "A task")
    assert store.load_threads("demo")[0][0]["hidden"] is False
    # hide a single thread and a single task
    m = store.set_hidden("demo", "thread", "t1", True)
    assert m["hidden"] is True
    store.set_hidden("demo", "task", "k1", True)
    assert store.load_tasks("demo")[0][0]["hidden"] is True
    # hiding resolves a code too (thread accepts code or id)
    store.set_hidden("demo", "thread", store.load_threads("demo")[0][0]["code"], False)
    assert store.load_threads("demo")[0][0]["hidden"] is False
    # a bad kind is rejected
    with pytest.raises(ValueError):
        store.set_hidden("demo", "decision", "x", True)


def test_read_updates_is_incremental_and_user_only(store):
    store.decision_add("demo", "d1", "q", "rec")
    # agent-authored events are not "updates" for the agent to act on
    up = store.read_updates("demo", since=0)
    assert up["new"] == []
    cursor = up["cursor"]
    # the user answering shows up as one update past the cursor, enriched with the answer
    store.decision_answer("demo", "d1", "go with A")
    up2 = store.read_updates("demo", since=cursor)
    assert len(up2["new"]) == 1
    assert up2["new"][0]["type"] == "decision_answered"
    assert up2["new"][0]["answer"] == "go with A"
    # once the cursor advances past it, nothing new
    assert store.read_updates("demo", since=up2["cursor"])["new"] == []


def test_read_updates_thread_and_note(store):
    store.thread_new("demo", "t", "Topic")
    c = store.read_updates("demo")["cursor"]
    store.thread_message("demo", "t", "hey there", by="user")
    store.note_add("demo", "a free note", by="user")
    up = store.read_updates("demo", since=c)
    types = {x["type"] for x in up["new"]}
    assert {"thread_message", "note"} <= types
    tm = [x for x in up["new"] if x["type"] == "thread_message"][0]
    assert "hey there" in tm["message"] and tm.get("code")  # carries the short code


def test_append_to_section_helper():
    body = "# T\n\n## Messages\n\n- old\n"
    out = _append_to_section(body, "Messages", "- new")
    assert out.index("- old") < out.index("- new")
    # creates the section if missing
    out2 = _append_to_section("# T\n", "Messages", "- first")
    assert "## Messages" in out2 and "- first" in out2


def test_replace_section_appends_when_missing():
    body = "# Title\n\n## Context\n\nhi\n"
    out = _replace_section(body, "Your decision", "answered!")
    assert "## Your decision" in out and "answered!" in out


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
