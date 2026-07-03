"""Storage layer for the orchestration console.

One directory per project holding Markdown documents with YAML frontmatter plus an
append-only ``feed.jsonl``. Frontmatter is the machine state; the body is the human prose.
This module is imported by ``console.py`` (the CLI) and ``console_web.py`` (the web app);
it is the single source of truth for the file protocol.

See ../design.md for the schema. No database, no external service. Files only.
"""

from __future__ import annotations

import fcntl
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import yaml

# --- states ------------------------------------------------------------------

TASK_STATES = ("queued", "running", "blocked", "in-review", "done", "dropped")
DECISION_STATES = ("open", "answered", "locked", "dropped")
PROJECT_STATES = ("active", "paused", "shipped", "archived")
# thread status says WHOSE TURN it is, not just done/not-done:
#   waiting       -> waiting on the user (needs their feedback)
#   investigating -> the agent is working on it / it is the agent's turn
#   resolved      -> done
THREAD_STATES = ("waiting", "investigating", "resolved", "promoted", "archived")

FEED_TYPES = (
    "message",
    "task_added",
    "task_updated",
    "task_message",
    "decision_raised",
    "decision_answered",
    "decision_locked",
    "thread_new",
    "thread_message",
    "thread_reply",
    "thread_resolved",
    "thread_promoted",
    "pr_opened",
    "note",
)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --- frontmatter -------------------------------------------------------------

_FM_RE = re.compile(r"^---\n(.*?)\n---\n?(.*)$", re.DOTALL)


def parse_doc(text: str) -> tuple[dict, str]:
    """Split a Markdown doc into (frontmatter dict, body)."""
    m = _FM_RE.match(text)
    if not m:
        return {}, text
    meta = yaml.safe_load(m.group(1)) or {}
    return meta, m.group(2)


def render_doc(meta: dict, body: str) -> str:
    fm = yaml.safe_dump(meta, sort_keys=False, allow_unicode=True).strip()
    body = body.rstrip("\n")
    return f"---\n{fm}\n---\n\n{body}\n"


def _replace_section(body: str, heading: str, new_content: str) -> str:
    """Replace the content under a ``## heading`` up to the next ``## `` or EOF."""
    lines = body.split("\n")
    out: list[str] = []
    i = 0
    replaced = False
    while i < len(lines):
        line = lines[i]
        if line.strip() == f"## {heading}":
            out.append(line)
            out.append("")
            out.append(new_content.rstrip("\n"))
            out.append("")
            i += 1
            while i < len(lines) and not lines[i].startswith("## "):
                i += 1
            replaced = True
            continue
        out.append(line)
        i += 1
    if not replaced:
        out.append("")
        out.append(f"## {heading}")
        out.append("")
        out.append(new_content.rstrip("\n"))
        out.append("")
    return "\n".join(out)


def _append_to_section(body: str, heading: str, block: str) -> str:
    """Append a block at the end of a ``## heading`` section, creating it if missing.

    Inserts a blank line before the block so consecutive message blocks stay separated and
    render as distinct markdown paragraphs.
    """
    lines = body.rstrip("\n").split("\n")
    idx = next((i for i, ln in enumerate(lines) if ln.strip() == f"## {heading}"), None)
    if idx is None:
        return "\n".join(lines + ["", f"## {heading}", "", block])
    # find the end of the section (next '## ' or EOF)
    end = idx + 1
    while end < len(lines) and not lines[end].startswith("## "):
        end += 1
    # trim trailing blank lines inside the section, then insert "blank line + block"
    insert_at = end
    while insert_at - 1 > idx and lines[insert_at - 1].strip() == "":
        insert_at -= 1
    lines[insert_at:insert_at] = ["", block]
    return "\n".join(lines)


_WHO_LABEL = {"user": "You", "orchestrator": "Agent", "agent": "Agent"}


def _short_time(iso: str) -> str:
    """'2026-07-01T13:54:47Z' -> 'Jul 1, 13:54'."""
    try:
        dt = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ")
        return dt.strftime("%b %-d, %H:%M")
    except ValueError:
        return iso


def _msg(who: str, text: str) -> str:
    """One message as a readable markdown block: a sender + short time header, then the text
    as its own markdown (so paragraphs, lists, links and code render properly)."""
    label = _WHO_LABEL.get(who, who)
    return f"**{label}** · {_short_time(now_iso())}\n\n{text.strip()}"


def _section_text(body: str, heading: str) -> str:
    """Return the text under a ``## heading`` up to the next ``## `` or EOF."""
    lines = body.split("\n")
    for i, ln in enumerate(lines):
        if ln.strip() == f"## {heading}":
            j = i + 1
            buf = []
            while j < len(lines) and not lines[j].startswith("## "):
                buf.append(lines[j])
                j += 1
            return "\n".join(buf).strip()
    return ""


_MSG_HDR = re.compile(r"^\*\*([^*]+)\*\* · (.+?)\s*$")


def parse_messages(section_text: str) -> list[dict]:
    """Split a Messages section into [{who, time, text}] so the UI can render each message
    as its own block instead of one continuous blob."""
    msgs: list[dict] = []
    cur: dict | None = None
    for ln in section_text.split("\n"):
        m = _MSG_HDR.match(ln.strip())
        if m:
            if cur:
                msgs.append(cur)
            cur = {"who": m.group(1).strip(), "time": m.group(2).strip(), "lines": []}
        elif cur is not None:
            cur["lines"].append(ln)
    if cur:
        msgs.append(cur)
    for c in msgs:
        c["text"] = "\n".join(c.pop("lines")).strip()
    return msgs


# --- store -------------------------------------------------------------------


class Store:
    def __init__(self, root: str | Path):
        self.root = Path(root)

    # paths
    def project_dir(self, pid: str) -> Path:
        return self.root / pid

    def _tasks_dir(self, pid: str) -> Path:
        return self.project_dir(pid) / "tasks"

    def _decisions_dir(self, pid: str) -> Path:
        return self.project_dir(pid) / "decisions"

    def _threads_dir(self, pid: str) -> Path:
        return self.project_dir(pid) / "threads"

    def _inbox_dir(self, pid: str) -> Path:
        return self.project_dir(pid) / "inbox"

    # low-level io
    def _read(self, path: Path) -> tuple[dict, str] | None:
        if not path.exists():
            return None
        return parse_doc(path.read_text())

    def _write(self, path: Path, meta: dict, body: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render_doc(meta, body))

    def _append_feed(self, pid: str, event: dict) -> dict:
        fp = self.project_dir(pid) / "feed.jsonl"
        fp.parent.mkdir(parents=True, exist_ok=True)
        with open(fp, "a+", encoding="utf-8") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                f.seek(0)
                seq = sum(1 for _ in f) + 1
                full = {"seq": seq, "ts": now_iso(), **event}
                f.write(json.dumps(full, ensure_ascii=False) + "\n")
                f.flush()  # flush before releasing the lock so the next writer counts this line
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
        return full

    # --- projects ------------------------------------------------------------
    def project_new(self, pid: str, title: str, goal: str = "") -> dict:
        path = self.project_dir(pid) / "project.md"
        if path.exists():
            raise FileExistsError(f"project '{pid}' already exists")
        ts = now_iso()
        meta = {
            "id": pid,
            "title": title,
            "goal": goal,
            "status": "active",
            "created": ts,
            "updated": ts,
        }
        body = (
            f"# {title}\n\n{goal}\n\n"
            "## Overview\n\n"
            "_Read-cold description of the problem this project solves. Link design docs "
            "and PRs here._\n"
        )
        self._write(path, meta, body)
        self._append_feed(
            pid,
            {
                "type": "message",
                "ref": None,
                "by": "orchestrator",
                "text": f"Project opened: {title}",
            },
        )
        return meta

    def project_set(
        self, pid: str, status: str | None = None, goal: str | None = None
    ) -> dict:
        path = self.project_dir(pid) / "project.md"
        got = self._read(path)
        if got is None:
            raise FileNotFoundError(f"project '{pid}' not found")
        meta, body = got
        if status is not None:
            if status not in PROJECT_STATES:
                raise ValueError(f"bad project status: {status}")
            meta["status"] = status
        if goal is not None:
            meta["goal"] = goal
        meta["updated"] = now_iso()
        self._write(path, meta, body)
        self._append_feed(
            pid,
            {
                "type": "message",
                "ref": None,
                "by": "orchestrator",
                "text": f"Project set: status={meta['status']}",
            },
        )
        return meta

    def list_projects(self) -> list[dict]:
        out = []
        if not self.root.exists():
            return out
        for d in sorted(self.root.iterdir()):
            if d.name.startswith("_"):  # e.g. _backlog is not a project
                continue
            got = self._read(d / "project.md")
            if got:
                out.append(got[0])
        return out

    def load_project(self, pid: str) -> tuple[dict, str]:
        got = self._read(self.project_dir(pid) / "project.md")
        if got is None:
            raise FileNotFoundError(f"project '{pid}' not found")
        return got

    # --- tasks ---------------------------------------------------------------
    def task_add(
        self,
        pid: str,
        tid: str,
        title: str,
        owner: str = "orchestrator",
        pr: str = "",
        design_doc: str = "",
        context: str = "",
    ) -> dict:
        path = self._tasks_dir(pid) / f"{tid}.md"
        if path.exists():
            raise FileExistsError(f"task '{tid}' already exists")
        ts = now_iso()
        meta = {
            "id": tid,
            "title": title,
            "status": "queued",
            "owner": owner,
            "pr": pr,
            "design_doc": design_doc,
            "blocked_on": "",
            "needs_reply": False,
            "hidden": False,  # the user can archive a single task from the UI
            "created": ts,
            "updated": ts,
        }
        # No placeholder prose: a Context section only when there is real context, plus a
        # Messages log the agent and the user both post into.
        ctx = f"## Context\n\n{context}\n\n" if context else ""
        body = f"# {title}\n\n{ctx}## Messages\n\n{_msg('agent', 'task created.')}\n"
        self._write(path, meta, body)
        self._append_feed(
            pid,
            {
                "type": "task_added",
                "ref": f"task:{tid}",
                "by": "orchestrator",
                "text": f"Task added: {title}",
            },
        )
        return meta

    def task_set(
        self,
        pid: str,
        tid: str,
        status: str | None = None,
        owner: str | None = None,
        pr: str | None = None,
        blocked_on: str | None = None,
        note: str | None = None,
        context: str | None = None,
    ) -> dict:
        path = self._tasks_dir(pid) / f"{tid}.md"
        got = self._read(path)
        if got is None:
            raise FileNotFoundError(f"task '{tid}' not found")
        meta, body = got
        changed = []
        if status is not None:
            if status not in TASK_STATES:
                raise ValueError(f"bad task status: {status}")
            meta["status"] = status
            changed.append(f"status={status}")
        if owner is not None:
            meta["owner"] = owner
            changed.append(f"owner={owner}")
        if pr is not None:
            meta["pr"] = pr
            changed.append("pr")
        if blocked_on is not None:
            meta["blocked_on"] = blocked_on
            changed.append(f"blocked_on={blocked_on}")
        if context is not None:
            body = _replace_section(body, "Context", context)
        meta["updated"] = now_iso()
        if note:
            # agent replies clear the "waiting on you" flag and land in the Messages log
            meta["needs_reply"] = False
            body = _append_to_section(body, "Messages", _msg("agent", note))
        self._write(path, meta, body)
        text = f"Task '{meta['title']}': " + (", ".join(changed) or "updated")
        if note:
            text += f" ({note})"
        etype = "pr_opened" if pr else "task_updated"
        self._append_feed(
            pid,
            {"type": etype, "ref": f"task:{tid}", "by": "orchestrator", "text": text},
        )
        return meta

    def load_tasks(self, pid: str) -> list[tuple[dict, str]]:
        d = self._tasks_dir(pid)
        if not d.exists():
            return []
        out = []
        for f in sorted(d.glob("*.md")):
            got = self._read(f)
            if got:
                out.append(got)
        return out

    def task_message(self, pid: str, tid: str, text: str, by: str = "user") -> dict:
        """User posts a message/note to a task from the UI. Flags it for the agent."""
        path = self._tasks_dir(pid) / f"{tid}.md"
        got = self._read(path)
        if got is None:
            raise FileNotFoundError(f"task '{tid}' not found")
        meta, body = got
        meta["needs_reply"] = True
        meta["updated"] = now_iso()
        body = _append_to_section(body, "Messages", _msg(by, text))
        self._write(path, meta, body)
        self._append_feed(
            pid,
            {
                "type": "task_message",
                "ref": f"task:{tid}",
                "by": by,
                "text": f"Message on task '{meta['title']}': {text}",
            },
        )
        return meta

    # --- threads -------------------------------------------------------------
    def _thread_code(self, pid: str, title: str) -> str:
        """A short memorable handle: 3 letters from the title + a per-project number,
        e.g. 'Telegram ...' -> TEL-3."""
        words = re.findall(r"[A-Za-z]{2,}", title)
        pick = next((w for w in words if len(w) >= 4), words[0] if words else "THR")
        letters = pick[:3].upper().ljust(3, "X")
        n = len(self.load_threads(pid)) + 1
        return f"{letters}-{n}"

    def _resolve_thread(self, pid: str, key: str) -> str:
        """Accept either a thread id or its short code (case-insensitive) and return the id."""
        if (self._threads_dir(pid) / f"{key}.md").exists():
            return key
        for m, _ in self.load_threads(pid):
            if str(m.get("code", "")).lower() == key.lower():
                return m["id"]
        return key  # unknown; the caller will raise a clear not-found

    def thread_new(
        self,
        pid: str,
        tid: str,
        title: str,
        summary: str = "",
        first_message: str = "",
        by: str = "orchestrator",
        status: str | None = None,
    ) -> dict:
        """A conversation on a topic: a running Summary plus a Messages log.

        Default status is ``investigating`` (the agent's turn): a user-opened question needs an
        answer, and an agent-opened thread means the agent is working on it. The agent flips it
        to ``waiting`` when it hands the ball back for feedback, or ``resolved`` when done.
        """
        path = self._threads_dir(pid) / f"{tid}.md"
        if path.exists():
            raise FileExistsError(f"thread '{tid}' already exists")
        if status is not None and status not in THREAD_STATES:
            raise ValueError(f"bad thread status: {status}")
        ts = now_iso()
        meta = {
            "id": tid,
            "code": self._thread_code(pid, title),  # short memorable handle, e.g. TEL-3
            "title": title,
            "status": status or "investigating",
            "needs_reply": by == "user",  # a user-opened thread waits on the agent
            "promoted_to": "",
            "hidden": False,  # the user can archive a single thread from the UI
            "created": ts,
            "updated": ts,
        }
        summ = summary or "_No summary yet._"
        first = f"\n\n{_msg(by, first_message)}" if first_message else ""
        body = f"# {title}\n\n## Summary\n\n{summ}\n\n## Messages{first}\n"
        self._write(path, meta, body)
        self._append_feed(
            pid,
            {
                "type": "thread_new",
                "ref": f"thread:{tid}",
                "by": by,
                "text": f"Thread opened: {title}",
            },
        )
        return meta

    def thread_message(self, pid: str, tid: str, text: str, by: str = "user") -> dict:
        """User posts into a thread from the UI. Flags it for the agent."""
        tid = self._resolve_thread(pid, tid)
        path = self._threads_dir(pid) / f"{tid}.md"
        got = self._read(path)
        if got is None:
            raise FileNotFoundError(f"thread '{tid}' not found")
        meta, body = got
        meta["needs_reply"] = True
        # the user posted, so the ball is now with the agent
        if meta.get("status") != "promoted":
            meta["status"] = "investigating"
        meta["updated"] = now_iso()
        body = _append_to_section(body, "Messages", _msg(by, text))
        self._write(path, meta, body)
        self._append_feed(
            pid,
            {
                "type": "thread_message",
                "ref": f"thread:{tid}",
                "by": by,
                "text": f"Message on '{meta['title']}': {text}",
            },
        )
        return meta

    def thread_reply(
        self,
        pid: str,
        tid: str,
        text: str,
        summary: str | None = None,
        by: str = "orchestrator",
        status: str = "waiting",
    ) -> dict:
        """Agent replies in a thread and (optionally) refreshes the running Summary.

        Sets whose turn it is next. Default ``waiting`` hands the ball back to the user; pass
        ``investigating`` to keep working, or ``resolved`` to close.
        """
        tid = self._resolve_thread(pid, tid)
        path = self._threads_dir(pid) / f"{tid}.md"
        got = self._read(path)
        if got is None:
            raise FileNotFoundError(f"thread '{tid}' not found")
        if status not in THREAD_STATES:
            raise ValueError(f"bad thread status: {status}")
        meta, body = got
        meta["needs_reply"] = False
        meta["status"] = status
        meta["updated"] = now_iso()
        if summary is not None:
            body = _replace_section(body, "Summary", summary)
        body = _append_to_section(body, "Messages", _msg(by, text))
        self._write(path, meta, body)
        self._append_feed(
            pid,
            {
                "type": "thread_reply",
                "ref": f"thread:{tid}",
                "by": by,
                "text": f"Reply on '{meta['title']}': {text}",
            },
        )
        return meta

    def thread_set(
        self, pid: str, tid: str, status: str | None = None, summary: str | None = None
    ) -> dict:
        tid = self._resolve_thread(pid, tid)
        path = self._threads_dir(pid) / f"{tid}.md"
        got = self._read(path)
        if got is None:
            raise FileNotFoundError(f"thread '{tid}' not found")
        meta, body = got
        if status is not None:
            if status not in THREAD_STATES:
                raise ValueError(f"bad thread status: {status}")
            meta["status"] = status
            # any status except "investigating" means the agent has nothing pending
            if status != "investigating":
                meta["needs_reply"] = False
        if summary is not None:
            body = _replace_section(body, "Summary", summary)
        meta["updated"] = now_iso()
        self._write(path, meta, body)
        etype = "thread_resolved" if status == "resolved" else "thread_message"
        self._append_feed(
            pid,
            {
                "type": etype,
                "ref": f"thread:{tid}",
                "by": "orchestrator",
                "text": f"Thread '{meta['title']}': {status or 'summary updated'}",
            },
        )
        return meta

    def thread_promote(
        self, pid: str, tid: str, task_id: str, owner: str = "orchestrator"
    ) -> dict:
        """Turn a thread into a task, carrying its summary across as the task Context."""
        tid = self._resolve_thread(pid, tid)
        got = self._read(self._threads_dir(pid) / f"{tid}.md")
        if got is None:
            raise FileNotFoundError(f"thread '{tid}' not found")
        tmeta, tbody = got
        summ = _section_text(
            tbody, "Summary"
        )  # carry the summary across as the task context
        self.task_add(pid, task_id, tmeta["title"], owner=owner, context=summ)
        self.thread_set(pid, tid, status="promoted")
        path = self._threads_dir(pid) / f"{tid}.md"
        m2, b2 = self._read(path)
        m2["promoted_to"] = task_id
        self._write(path, m2, b2)
        self._append_feed(
            pid,
            {
                "type": "thread_promoted",
                "ref": f"thread:{tid}",
                "by": "orchestrator",
                "text": f"Thread '{tmeta['title']}' promoted to task {task_id}",
            },
        )
        return m2

    def load_threads(self, pid: str) -> list[tuple[dict, str]]:
        d = self._threads_dir(pid)
        if not d.exists():
            return []
        out = []
        for f in sorted(d.glob("*.md")):
            got = self._read(f)
            if got:
                out.append(got)
        return out

    def set_hidden(
        self, pid: str, kind: str, item_id: str, hidden: bool = True
    ) -> dict:
        """Archive (hide) or restore a single thread or task. `kind` is 'thread' or 'task'."""
        if kind == "thread":
            item_id = self._resolve_thread(pid, item_id)
            path = self._threads_dir(pid) / f"{item_id}.md"
        elif kind == "task":
            path = self._tasks_dir(pid) / f"{item_id}.md"
        else:
            raise ValueError(f"cannot hide a {kind}")
        got = self._read(path)
        if got is None:
            raise FileNotFoundError(f"{kind} '{item_id}' not found")
        meta, body = got
        meta["hidden"] = hidden
        meta["updated"] = now_iso()
        self._write(path, meta, body)
        return meta

    # --- backlog (cross-project, lives at the console root) ------------------
    def _backlog_dir(self) -> Path:
        return self.root / "_backlog"

    def backlog_add(
        self,
        bid: str,
        title: str,
        note: str = "",
        kind: str = "note",
        status: str = "open",
        source_project: str = "",
        source_thread: str = "",
        links: list[dict] | None = None,
    ) -> dict:
        """A saved item in the cross-project backlog. `kind` is 'note' (saved info) or
        'task' (future work). `links` is a list of {label, href}."""
        path = self._backlog_dir() / f"{bid}.md"
        if path.exists():
            raise FileExistsError(f"backlog item '{bid}' already exists")
        ts = now_iso()
        meta = {
            "id": bid,
            "title": title,
            "kind": kind,
            "status": status,
            "source_project": source_project,
            "source_thread": source_thread,
            "created": ts,
            "updated": ts,
        }
        links = links or []
        if source_project and source_thread:
            links = [
                {
                    "label": f"{source_project} · thread {source_thread}",
                    "href": f"/p/{source_project}#thread-{source_thread}",
                },
                *links,
            ]
        links_md = (
            "\n".join(f"- [{ln['label']}]({ln['href']})" for ln in links) or "_none_"
        )
        body = (
            f"# {title}\n\n## Notes\n\n{note or '_No notes yet._'}\n\n"
            f"## Links\n\n{links_md}\n"
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        self._write(path, meta, body)
        return meta

    def backlog_from_thread(
        self,
        pid: str,
        tid: str,
        bid: str | None = None,
        title: str | None = None,
        kind: str = "task",
    ) -> dict:
        """Save a thread into the backlog: copy its Summary as the note and link back to it."""
        tid = self._resolve_thread(pid, tid)
        got = self._read(self._threads_dir(pid) / f"{tid}.md")
        if got is None:
            raise FileNotFoundError(f"thread '{tid}' not found")
        tmeta, tbody = got
        summary = _section_text(tbody, "Summary")
        bid = bid or f"{pid}-{tid}"
        item = self.backlog_add(
            bid,
            title or tmeta["title"],
            note=summary,
            kind=kind,
            source_project=pid,
            source_thread=tid,
        )
        self._append_feed(
            pid,
            {
                "type": "message",
                "ref": f"thread:{tid}",
                "by": "user",
                "text": f"Saved to backlog: {item['title']}",
            },
        )
        return item

    def backlog_set(
        self, bid: str, status: str | None = None, note: str | None = None
    ) -> dict:
        path = self._backlog_dir() / f"{bid}.md"
        got = self._read(path)
        if got is None:
            raise FileNotFoundError(f"backlog item '{bid}' not found")
        meta, body = got
        if status is not None:
            meta["status"] = status
        if note:
            body = _append_to_section(body, "Notes", _msg("user", note))
        meta["updated"] = now_iso()
        self._write(path, meta, body)
        return meta

    def load_backlog(self) -> list[tuple[dict, str]]:
        d = self._backlog_dir()
        if not d.exists():
            return []
        out = []
        for f in sorted(d.glob("*.md")):
            got = self._read(f)
            if got:
                out.append(got)
        return out

    # --- decisions -----------------------------------------------------------
    def decision_add(
        self,
        pid: str,
        did: str,
        title: str,
        recommendation: str,
        task: str = "",
        pr: str = "",
        context: str = "",
        options: list[str] | None = None,
    ) -> dict:
        path = self._decisions_dir(pid) / f"{did}.md"
        if path.exists():
            raise FileExistsError(f"decision '{did}' already exists")
        ts = now_iso()
        meta = {
            "id": did,
            "title": title,
            "status": "open",
            "task": task,
            "pr": pr,
            "recommendation": recommendation,
            "answer": "",
            "answered_by": "",
            "raised": ts,
            "updated": ts,
        }
        opts = options or ["_Option A_", "_Option B_"]
        opts_md = "\n".join(f"- {o}" for o in opts)
        body = (
            f"# {title}\n\n"
            f"## Context\n\n{context or '_Why this needs a call, read cold._'}\n\n"
            f"## Options\n\n{opts_md}\n\n"
            f"## Recommendation\n\n{recommendation}\n\n"
            "## Your decision\n\n_Awaiting your call._\n"
        )
        self._write(path, meta, body)
        self._append_feed(
            pid,
            {
                "type": "decision_raised",
                "ref": f"decision:{did}",
                "by": "orchestrator",
                "text": f"Decision needs you: {title}",
            },
        )
        return meta

    def decision_answer(
        self, pid: str, did: str, answer: str, by: str = "user"
    ) -> dict:
        """User writeback (from the UI). Moves open -> answered. Never locks."""
        path = self._decisions_dir(pid) / f"{did}.md"
        got = self._read(path)
        if got is None:
            raise FileNotFoundError(f"decision '{did}' not found")
        meta, body = got
        if meta.get("status") == "locked":
            raise ValueError("decision already locked")
        meta["status"] = "answered"
        meta["answer"] = answer
        meta["answered_by"] = by
        meta["updated"] = now_iso()
        body = _replace_section(
            body, "Your decision", f"**{by}:** {answer}\n\n_{meta['updated']}_"
        )
        self._write(path, meta, body)
        self._append_feed(
            pid,
            {
                "type": "decision_answered",
                "ref": f"decision:{did}",
                "by": by,
                "text": f"Answered '{meta['title']}': {answer}",
            },
        )
        return meta

    def decision_lock(
        self, pid: str, did: str, answer: str | None = None, outcome: str = ""
    ) -> dict:
        """Agent-only. Moves answered -> locked, records the outcome."""
        path = self._decisions_dir(pid) / f"{did}.md"
        got = self._read(path)
        if got is None:
            raise FileNotFoundError(f"decision '{did}' not found")
        meta, body = got
        if answer is not None:
            meta["answer"] = answer
        meta["status"] = "locked"
        meta["updated"] = now_iso()
        if not meta.get("answered_by"):
            meta["answered_by"] = "orchestrator"
        section = f"**Locked:** {meta.get('answer', '')}"
        if outcome:
            section += f"\n\n{outcome}"
        section += f"\n\n_{meta['updated']}_"
        body = _replace_section(body, "Your decision", section)
        self._write(path, meta, body)
        self._append_feed(
            pid,
            {
                "type": "decision_locked",
                "ref": f"decision:{did}",
                "by": "orchestrator",
                "text": f"Decided (locked): {meta['title']}",
            },
        )
        return meta

    def decision_drop(self, pid: str, did: str, reason: str = "") -> dict:
        path = self._decisions_dir(pid) / f"{did}.md"
        got = self._read(path)
        if got is None:
            raise FileNotFoundError(f"decision '{did}' not found")
        meta, body = got
        meta["status"] = "dropped"
        meta["updated"] = now_iso()
        self._write(path, meta, body)
        self._append_feed(
            pid,
            {
                "type": "message",
                "ref": f"decision:{did}",
                "by": "orchestrator",
                "text": f"Decision dropped: {meta['title']} ({reason})",
            },
        )
        return meta

    def load_decisions(self, pid: str) -> list[tuple[dict, str]]:
        d = self._decisions_dir(pid)
        if not d.exists():
            return []
        out = []
        for f in sorted(d.glob("*.md")):
            got = self._read(f)
            if got:
                out.append(got)
        return out

    # --- feed / messages / notes --------------------------------------------
    def message(
        self, pid: str, text: str, ref: str | None = None, by: str = "orchestrator"
    ) -> dict:
        return self._append_feed(
            pid, {"type": "message", "ref": ref, "by": by, "text": text}
        )

    def note_add(self, pid: str, text: str, by: str = "user") -> dict:
        """User free-text feedback from the UI, awaiting orchestrator pickup."""
        ts = now_iso()
        nid = ts.replace(":", "").replace("-", "")
        path = self._inbox_dir(pid) / f"{nid}.md"
        meta = {"id": nid, "status": "new", "by": by, "created": ts}
        self._write(path, meta, f"{text}\n")
        self._append_feed(
            pid, {"type": "note", "ref": None, "by": by, "text": f"Note: {text}"}
        )
        return meta

    def note_ack(self, pid: str, nid: str) -> dict:
        path = self._inbox_dir(pid) / f"{nid}.md"
        got = self._read(path)
        if got is None:
            raise FileNotFoundError(f"note '{nid}' not found")
        meta, body = got
        meta["status"] = "seen"
        self._write(path, meta, body)
        return meta

    def load_notes(self, pid: str, only_new: bool = False) -> list[tuple[dict, str]]:
        d = self._inbox_dir(pid)
        if not d.exists():
            return []
        out = []
        for f in sorted(d.glob("*.md")):
            got = self._read(f)
            if got and (not only_new or got[0].get("status") == "new"):
                out.append(got)
        return out

    def read_feed(self, pid: str, since: int = 0) -> list[dict]:
        fp = self.project_dir(pid) / "feed.jsonl"
        if not fp.exists():
            return []
        out = []
        for line in fp.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            ev = json.loads(line)
            if ev.get("seq", 0) > since:
                out.append(ev)
        return out

    # --- read-back for the agent --------------------------------------------
    @staticmethod
    def _last_message(body: str) -> str:
        """Return the last message block's 'sender: text' as a compact preview."""
        lines = body.split("\n")
        hdr = None
        for i, ln in enumerate(lines):
            if re.match(r"^\*\*[^*]+\*\* · ", ln.strip()):
                hdr = i
        if hdr is None:
            return ""
        who = re.match(r"^\*\*([^*]+)\*\*", lines[hdr].strip()).group(1)
        rest = " ".join(x.strip() for x in lines[hdr + 1 :] if x.strip())
        return f"{who}: {rest}"[:300]

    def read_pending(self, pid: str) -> dict:
        """Everything waiting on the agent: answered decisions, threads and tasks the user
        posted into, and new inbox notes. This is the start-of-turn read."""
        answered = [
            m for m, _ in self.load_decisions(pid) if m.get("status") == "answered"
        ]
        threads = [
            {
                "id": m["id"],
                "code": m.get("code", ""),
                "title": m["title"],
                "last_message": self._last_message(b),
            }
            for m, b in self.load_threads(pid)
            if m.get("needs_reply")
        ]
        tasks = [
            {"id": m["id"], "title": m["title"], "last_message": self._last_message(b)}
            for m, b in self.load_tasks(pid)
            if m.get("needs_reply")
        ]
        notes = [
            {"id": m["id"], "by": m.get("by"), "text": b.strip()}
            for m, b in self.load_notes(pid, only_new=True)
        ]
        return {
            "answered_decisions": answered,
            "threads": threads,
            "tasks": tasks,
            "notes": notes,
        }

    def read_updates(self, pid: str, since: int = 0) -> dict:
        """What the USER did since feed seq `since`, enriched for the agent. This is the
        incremental read: only what's new, never the whole board. Returns
        ``{since, cursor, new:[...]}`` where `cursor` is the latest feed seq to pass next time."""
        feed = self.read_feed(pid)
        cursor = feed[-1]["seq"] if feed else since
        new = []
        for e in feed:
            if e["seq"] <= since or e.get("by") != "user":
                continue
            ref = e.get("ref") or ""
            kind, _, key = ref.partition(":")
            item = {"seq": e["seq"], "type": e["type"]}
            if kind == "thread":
                got = self._read(self._threads_dir(pid) / f"{key}.md")
                if got:
                    item["code"] = got[0].get("code", "")
                    item["title"] = got[0].get("title", "")
                    item["message"] = self._last_message(got[1])
            elif kind == "decision":
                got = self._read(self._decisions_dir(pid) / f"{key}.md")
                if got:
                    item["title"] = got[0].get("title", "")
                    item["answer"] = got[0].get("answer", "")
            elif kind == "task":
                got = self._read(self._tasks_dir(pid) / f"{key}.md")
                if got:
                    item["title"] = got[0].get("title", "")
                    item["message"] = self._last_message(got[1])
            else:
                item["text"] = e.get("text", "")  # a project-level note
            new.append(item)
        return {"since": since, "cursor": cursor, "new": new}

    def read_status(self, pid: str) -> dict:
        pmeta, _ = self.load_project(pid)
        tasks = [m for m, _ in self.load_tasks(pid)]
        decisions = [m for m, _ in self.load_decisions(pid)]
        threads = [m for m, _ in self.load_threads(pid)]
        feed = self.read_feed(pid)
        return {
            "project": pmeta,
            "tasks": tasks,
            "decisions": decisions,
            "threads": threads,
            "feed_len": len(feed),
            "last_seq": feed[-1]["seq"] if feed else 0,
        }
