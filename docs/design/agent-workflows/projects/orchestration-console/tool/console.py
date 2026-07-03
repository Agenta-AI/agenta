# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6"]
# ///
"""orchestration console CLI.

The action surface the orchestrator agent drives. Every command edits the per-project
Markdown files and appends the matching feed event. See ../design.md and ../TESTING.md.

    uv run console.py --root <dir> <command> ...

CONSOLE_ROOT env var supplies --root if the flag is omitted (default:
docs/design/agent-workflows/scratch/console).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from console_store import Store  # noqa: E402

DEFAULT_ROOT = "docs/design/agent-workflows/scratch/console"


def _print(obj) -> None:
    print(json.dumps(obj, indent=2, ensure_ascii=False, default=str))


def _fmt_status(s: dict) -> str:
    p = s["project"]
    lines = [f"# {p['title']}  [{p['status']}]", f"  goal: {p.get('goal', '')}", ""]
    by_status: dict[str, list] = {}
    for t in s["tasks"]:
        by_status.setdefault(t["status"], []).append(t)
    lines.append("## Tasks")
    if not s["tasks"]:
        lines.append("  (none)")
    for st in ("running", "blocked", "in-review", "queued", "done", "dropped"):
        for t in by_status.get(st, []):
            pr = f"  {t['pr']}" if t.get("pr") else ""
            blk = f"  blocked_on={t['blocked_on']}" if t.get("blocked_on") else ""
            wait = "  <- you posted" if t.get("needs_reply") else ""
            lines.append(
                f"  [{st}] {t['id']}: {t['title']}  ({t['owner']}){pr}{blk}{wait}"
            )
    lines.append("")
    lines.append("## Threads")
    tlabel = {"waiting": "WAITING ON USER", "investigating": "investigating"}
    threads = [
        t for t in s.get("threads", []) if t["status"] not in ("resolved", "archived")
    ]
    if not threads:
        lines.append("  (none active)")
    # waiting-on-user first, then investigating
    for t in sorted(threads, key=lambda t: 0 if t["status"] == "waiting" else 1):
        lab = tlabel.get(t["status"], t["status"])
        unread = "  (unread post)" if t.get("needs_reply") else ""
        prom = f"  -> task {t['promoted_to']}" if t.get("promoted_to") else ""
        code = f"{t['code']} " if t.get("code") else ""
        lines.append(f"  [{lab}] {code}{t['id']}: {t['title']}{prom}{unread}")
    lines.append("")
    lines.append("## Decisions")
    open_d = [d for d in s["decisions"] if d["status"] in ("open", "answered")]
    if not open_d:
        lines.append("  (none open)")
    for d in open_d:
        lines.append(f"  [{d['status']}] {d['id']}: {d['title']}")
        lines.append(f"       rec: {d.get('recommendation', '')}")
        if d.get("answer"):
            lines.append(f"       answer: {d['answer']}")
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="console", description="orchestration console CLI"
    )
    ap.add_argument("--root", default=os.environ.get("CONSOLE_ROOT", DEFAULT_ROOT))
    sub = ap.add_subparsers(dest="cmd", required=True)

    # project
    p = sub.add_parser("project")
    ps = p.add_subparsers(dest="sub", required=True)
    x = ps.add_parser("new")
    x.add_argument("id")
    x.add_argument("--title", required=True)
    x.add_argument("--goal", default="")
    x = ps.add_parser("set")
    x.add_argument("id")
    x.add_argument("--status")
    x.add_argument("--goal")
    ps.add_parser("list")

    # task
    t = sub.add_parser("task")
    ts = t.add_subparsers(dest="sub", required=True)
    x = ts.add_parser("add")
    x.add_argument("id")
    x.add_argument("--project", required=True)
    x.add_argument("--title", required=True)
    x.add_argument("--owner", default="orchestrator")
    x.add_argument("--pr", default="")
    x.add_argument("--design", default="")
    x.add_argument("--context", default="")
    x = ts.add_parser("set")
    x.add_argument("id")
    x.add_argument("--project", required=True)
    x.add_argument("--status")
    x.add_argument("--owner")
    x.add_argument("--pr")
    x.add_argument("--blocked-on", dest="blocked_on")
    x.add_argument("--note")
    x.add_argument("--context")
    x = ts.add_parser("message")  # the UI writeback path; also handy for testing
    x.add_argument("id")
    x.add_argument("--project", required=True)
    x.add_argument("--text", required=True)
    x.add_argument("--by", default="user")

    # thread (a conversation on a topic)
    th = sub.add_parser("thread")
    ths = th.add_subparsers(dest="sub", required=True)
    x = ths.add_parser("new")
    x.add_argument("id")
    x.add_argument("--project", required=True)
    x.add_argument("--title", required=True)
    x.add_argument("--summary", default="")
    x.add_argument("--message", default="", dest="first_message")
    x.add_argument("--by", default="orchestrator")
    x = ths.add_parser("reply")  # agent replies + optionally refreshes the summary
    x.add_argument("id")
    x.add_argument("--project", required=True)
    x.add_argument("--text", required=True)
    x.add_argument("--summary")
    # whose turn next: default hands the ball back to the user
    x.add_argument(
        "--status", choices=["waiting", "investigating", "resolved"], default="waiting"
    )
    x = ths.add_parser("message")  # the UI writeback path; also handy for testing
    x.add_argument("id")
    x.add_argument("--project", required=True)
    x.add_argument("--text", required=True)
    x.add_argument("--by", default="user")
    x = ths.add_parser("set")
    x.add_argument("id")
    x.add_argument("--project", required=True)
    x.add_argument("--status")
    x.add_argument("--summary")
    x = ths.add_parser("promote")  # turn a thread into a task
    x.add_argument("id")
    x.add_argument("--project", required=True)
    x.add_argument("--task", required=True)
    x.add_argument("--owner", default="orchestrator")

    # decision
    d = sub.add_parser("decision")
    ds = d.add_subparsers(dest="sub", required=True)
    x = ds.add_parser("add")
    x.add_argument("id")
    x.add_argument("--project", required=True)
    x.add_argument("--title", required=True)
    x.add_argument("--rec", required=True)
    x.add_argument("--task", default="")
    x.add_argument("--pr", default="")
    x.add_argument("--context", default="")
    x.add_argument("--option", action="append", dest="options")
    x = ds.add_parser("answer")
    x.add_argument("id")
    x.add_argument("--project", required=True)
    x.add_argument("--answer", required=True)
    x.add_argument("--by", default="user")
    x = ds.add_parser("lock")
    x.add_argument("id")
    x.add_argument("--project", required=True)
    x.add_argument("--answer")
    x.add_argument("--outcome", default="")
    x = ds.add_parser("drop")
    x.add_argument("id")
    x.add_argument("--project", required=True)
    x.add_argument("--reason", default="")

    # message / note
    x = sub.add_parser("message")
    x.add_argument("text")
    x.add_argument("--project", required=True)
    x.add_argument("--ref")
    x.add_argument("--by", default="orchestrator")
    n = sub.add_parser("note")
    ns = n.add_subparsers(dest="sub", required=True)
    x = ns.add_parser("add")
    x.add_argument("text")
    x.add_argument("--project", required=True)
    x.add_argument("--by", default="user")
    x = ns.add_parser("ack")
    x.add_argument("id")
    x.add_argument("--project", required=True)

    # backlog (cross-project; no --project)
    bl = sub.add_parser("backlog")
    bls = bl.add_subparsers(dest="sub", required=True)
    x = bls.add_parser("add")
    x.add_argument("id")
    x.add_argument("--title", required=True)
    x.add_argument("--note", default="")
    x.add_argument("--kind", choices=["note", "task"], default="note")
    x.add_argument("--status", default="open")
    x.add_argument("--link", action="append", dest="links", help='"label|href"')
    x = bls.add_parser("from-thread")  # save a thread into the backlog
    x.add_argument("--project", required=True)
    x.add_argument("--thread", required=True)
    x.add_argument("--id")
    x.add_argument("--title")
    x.add_argument("--kind", choices=["note", "task"], default="task")
    x = bls.add_parser("set")
    x.add_argument("id")
    x.add_argument("--status")
    x.add_argument("--note")
    bls.add_parser("list")

    # read-back
    x = sub.add_parser("status")
    x.add_argument("--project", required=True)
    x.add_argument("--json", action="store_true")
    x = sub.add_parser("pending")
    x.add_argument("--project", required=True)
    x = sub.add_parser("feed")
    x.add_argument("--project", required=True)
    x.add_argument("--since", type=int, default=0)
    # incremental: only what the user changed since a cursor
    x = sub.add_parser("poll")
    x.add_argument("--project", required=True)
    x.add_argument("--since", type=int, default=0)
    # block until the user acts (or timeout), checking every --interval seconds
    x = sub.add_parser("watch")
    x.add_argument("--project", required=True)
    x.add_argument("--since", type=int, default=0)
    x.add_argument("--timeout", type=int, default=540)
    x.add_argument("--interval", type=int, default=30)

    args = ap.parse_args(argv)
    store = Store(args.root)

    try:
        if args.cmd == "project":
            if args.sub == "new":
                _print(store.project_new(args.id, args.title, args.goal))
            elif args.sub == "set":
                _print(store.project_set(args.id, args.status, args.goal))
            elif args.sub == "list":
                _print(store.list_projects())
        elif args.cmd == "task":
            if args.sub == "add":
                _print(
                    store.task_add(
                        args.project,
                        args.id,
                        args.title,
                        args.owner,
                        args.pr,
                        args.design,
                        args.context,
                    )
                )
            elif args.sub == "set":
                _print(
                    store.task_set(
                        args.project,
                        args.id,
                        args.status,
                        args.owner,
                        args.pr,
                        args.blocked_on,
                        args.note,
                        args.context,
                    )
                )
            elif args.sub == "message":
                _print(store.task_message(args.project, args.id, args.text, args.by))
        elif args.cmd == "thread":
            if args.sub == "new":
                _print(
                    store.thread_new(
                        args.project,
                        args.id,
                        args.title,
                        args.summary,
                        args.first_message,
                        args.by,
                    )
                )
            elif args.sub == "reply":
                _print(
                    store.thread_reply(
                        args.project,
                        args.id,
                        args.text,
                        args.summary,
                        status=args.status,
                    )
                )
            elif args.sub == "message":
                _print(store.thread_message(args.project, args.id, args.text, args.by))
            elif args.sub == "set":
                _print(
                    store.thread_set(args.project, args.id, args.status, args.summary)
                )
            elif args.sub == "promote":
                _print(
                    store.thread_promote(args.project, args.id, args.task, args.owner)
                )
        elif args.cmd == "decision":
            if args.sub == "add":
                _print(
                    store.decision_add(
                        args.project,
                        args.id,
                        args.title,
                        args.rec,
                        args.task,
                        args.pr,
                        args.context,
                        args.options,
                    )
                )
            elif args.sub == "answer":
                _print(
                    store.decision_answer(args.project, args.id, args.answer, args.by)
                )
            elif args.sub == "lock":
                _print(
                    store.decision_lock(
                        args.project, args.id, args.answer, args.outcome
                    )
                )
            elif args.sub == "drop":
                _print(store.decision_drop(args.project, args.id, args.reason))
        elif args.cmd == "backlog":
            if args.sub == "add":
                links = [
                    {"label": s.split("|", 1)[0], "href": s.split("|", 1)[-1]}
                    for s in (args.links or [])
                ]
                _print(
                    store.backlog_add(
                        args.id,
                        args.title,
                        args.note,
                        args.kind,
                        args.status,
                        links=links,
                    )
                )
            elif args.sub == "from-thread":
                _print(
                    store.backlog_from_thread(
                        args.project, args.thread, args.id, args.title, args.kind
                    )
                )
            elif args.sub == "set":
                _print(store.backlog_set(args.id, args.status, args.note))
            elif args.sub == "list":
                _print([m for m, _ in store.load_backlog()])
        elif args.cmd == "message":
            _print(store.message(args.project, args.text, args.ref, args.by))
        elif args.cmd == "note":
            if args.sub == "add":
                _print(store.note_add(args.project, args.text, args.by))
            elif args.sub == "ack":
                _print(store.note_ack(args.project, args.id))
        elif args.cmd == "status":
            s = store.read_status(args.project)
            print(json.dumps(s, indent=2, default=str) if args.json else _fmt_status(s))
        elif args.cmd == "pending":
            _print(store.read_pending(args.project))
        elif args.cmd == "poll":
            _print(store.read_updates(args.project, args.since))
        elif args.cmd == "watch":
            import time

            end = time.monotonic() + args.timeout
            while True:
                upd = store.read_updates(args.project, args.since)
                if upd["new"] or time.monotonic() >= end:
                    _print(upd)
                    break
                time.sleep(max(1, min(args.interval, end - time.monotonic())))
        elif args.cmd == "feed":
            for ev in store.read_feed(args.project, args.since):
                print(
                    f"[{ev['seq']:>4}] {ev['ts']}  {ev['type']:<18} {ev.get('by', ''):<14} {ev['text']}"
                )
    except (FileExistsError, FileNotFoundError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
