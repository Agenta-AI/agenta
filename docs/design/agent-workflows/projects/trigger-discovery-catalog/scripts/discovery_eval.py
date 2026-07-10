# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Offline evaluation of discover_triggers over the real Composio catalog.

Extracts the REAL scorer functions from api/oss/src/core/triggers/service.py via AST
(no copy drift), replicates the surfacing pipeline of `discover_triggers`
(_discover_events_for_use_case -> named-integration filter -> primary-evidence gate ->
no-match alternatives), and measures behavior over a large realistic query corpus:

- usecase/fragment: 800+ queries templated from real event names; measures top1/top4/miss.
- browse: "slack triggers"-shaped asks per toolkit; measures right/wrong toolkit + empties.
- hand: hand-written realistic asks with expected event keys, plus asks the catalog
  genuinely cannot answer (honest no-match is correct there).
- deprecated: whether DEPRECATED events surface anywhere.

Run: COMPOSIO_API_KEY=... uv run scripts/discovery_eval.py
(the key is only needed on the first run, to populate the local catalog cache).
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from types import SimpleNamespace
from typing import Dict, List, Optional, Tuple, Set

import ast


def _repo_root() -> Path:
    path = Path(__file__).resolve()
    for parent in path.parents:
        if (
            parent / "api" / "oss" / "src" / "core" / "triggers" / "service.py"
        ).exists():
            return parent
    raise SystemExit("could not locate the agenta repo root above this script")


SERVICE = _repo_root() / "api" / "oss" / "src" / "core" / "triggers" / "service.py"

# The catalog dump must NEVER be committed to the repo (Composio ToS, decision D1 in
# status.md). It lives only in this local cache and is fetched live when absent.
CATALOG_CACHE = Path.home() / ".cache" / "agenta-discovery-eval" / "catalog.json"

COMPOSIO_API_URL = "https://backend.composio.dev/api/v3"

WANTED = {
    "_DISCOVERY_MIN_PRIMARY_TERMS",
    "_DISCOVERY_STOPWORDS",
    "_discovery_terms",
    "_normalize_words",
    "_named_integrations",
    "_match_signal",
    "_score_trigger_match",
    "_has_primary_evidence",
}


def load_scorer():
    tree = ast.parse(SERVICE.read_text())
    nodes = []
    for node in tree.body:
        name = None
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            name = node.name
        elif isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
        if name in WANTED:
            nodes.append(node)
    mod = ast.Module(body=nodes, type_ignores=[])
    ns = {
        "List": List,
        "Dict": Dict,
        "Optional": Optional,
        "Tuple": Tuple,
        "Set": Set,
        "TriggerCatalogEvent": object,
        "TriggerCatalogIntegration": object,
    }
    exec(compile(mod, str(SERVICE), "exec"), ns)
    assert all(w in ns for w in WANTED), [w for w in WANTED if w not in ns]
    return ns


def fetch_catalog() -> list:
    api_key = os.environ.get("COMPOSIO_API_KEY")
    if not api_key:
        raise SystemExit(
            f"no cached catalog at {CATALOG_CACHE} and COMPOSIO_API_KEY is not set; "
            "export it to fetch the live catalog once"
        )
    items, cursor, seen = [], None, set()
    for _ in range(200):
        params = {"limit": "100"}
        if cursor:
            params["cursor"] = cursor
        req = urllib.request.Request(
            f"{COMPOSIO_API_URL}/triggers_types?{urllib.parse.urlencode(params)}",
            headers={"x-api-key": api_key, "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.load(resp)
        items.extend(data.get("items", []) if isinstance(data, dict) else data)
        cursor = data.get("next_cursor") if isinstance(data, dict) else None
        if not cursor or cursor in seen:
            break
        seen.add(cursor)
    return items


def load_catalog():
    if not CATALOG_CACHE.exists():
        CATALOG_CACHE.parent.mkdir(parents=True, exist_ok=True)
        CATALOG_CACHE.write_text(json.dumps(fetch_catalog()))
    raw = json.loads(CATALOG_CACHE.read_text())
    events, integ_names = [], {}
    for it in raw:
        tk = it.get("toolkit") or {}
        slug = tk.get("slug") or ""
        integ_names[slug] = tk.get("name") or slug
        events.append(
            SimpleNamespace(
                key=it["slug"],
                name=it.get("name"),
                description=it.get("description"),
                integration=slug,
            )
        )
    return events, integ_names


# ---------------------------------------------------------------- discovery replica


def discover(ns, events, integ_names, use_case, limit_alternatives=3):
    """Faithful replica of discover_triggers surfacing for one use case.

    Mirrors _discover_events_for_use_case (score + named-integration filter + sort),
    the _has_primary_evidence gate, and the no-match alternatives path.
    Returns (primary, alternatives, note) where primary/alternatives are event objects.
    """
    integrations = {}
    matches = []
    seen = set()
    for event in events:
        slug = event.integration or ""
        # mirror _discover_events_for_use_case's (slug, key) dedup
        if (slug, event.key) in seen:
            continue
        seen.add((slug, event.key))
        integ = integrations.get(slug)
        if integ is None:
            integ = SimpleNamespace(
                key=slug, name=integ_names.get(slug, slug), description=None
            )
            integrations[slug] = integ
        score = ns["_score_trigger_match"](
            use_case=use_case, event=event, integration=integ
        )
        if score <= 0:
            continue
        matches.append((score, event, integ))

    named = ns["_named_integrations"](
        terms=ns["_discovery_terms"](use_case), integrations=integrations
    )
    if named:
        matches = [m for m in matches if (m[1].integration or "") in named]
    matches.sort(key=lambda m: m[0], reverse=True)

    surfaced = matches[: 1 + max(limit_alternatives, 0)]
    if surfaced:
        _score, matched_terms, exact = ns["_match_signal"](
            use_case=use_case, event=surfaced[0][1], integration=surfaced[0][2]
        )
        if not (exact or matched_terms >= ns["_DISCOVERY_MIN_PRIMARY_TERMS"]):
            surfaced = []

    if not surfaced:
        alts = [m[1] for m in matches[: max(limit_alternatives, 0)]]
        return None, alts, "no-match+alts" if alts else "no-match"
    return surfaced[0][1], [m[1] for m in surfaced[1:]], None


# ---------------------------------------------------------------- corpus


def build_corpus(events, integ_names):
    """Returns list of dicts: {q, category, expect} where expect is a set of acceptable
    event keys (None = we only measure behavior, not correctness)."""
    corpus = []
    by_integration = defaultdict(list)
    for e in events:
        by_integration[e.integration].append(e)

    # A. ground-truth: natural phrasings templated from event name + toolkit name
    for e in events:
        if (e.description or "").strip().lower().startswith("deprecated"):
            continue
        name = (e.name or "").lower().replace("trigger", "").strip()
        if not name:
            continue
        tk = integ_names.get(e.integration, e.integration).lower()
        # acceptable: this event OR an event with identical name in a sibling toolkit
        expect = {
            o.key for o in events if (o.name or "").lower() == (e.name or "").lower()
        }
        corpus.append(
            {"q": f"when {name} in {tk}", "category": "usecase", "expect": expect}
        )
        corpus.append({"q": f"{tk} {name}", "category": "fragment", "expect": expect})

    # B. browse-shaped: agent asks for the menu; success = anything from that toolkit.
    # Agents type spaced names ("google calendar"), not slugs ("googlecalendar").
    SPACED = {
        "googlecalendar": "google calendar",
        "googledrive": "google drive",
        "googlesheets": "google sheets",
        "googledocs": "google docs",
        "googleslides": "google slides",
        "googletasks": "google tasks",
        "one_drive": "one drive",
        "agent_mail": "agent mail",
    }
    for slug in sorted(by_integration):
        tk = SPACED.get(slug, integ_names.get(slug, slug).lower())
        for q in (
            f"{tk} triggers",
            f"{tk} events",
            f"list {tk} triggers",
            f"what triggers does {tk} support",
        ):
            corpus.append(
                {"q": q, "category": "browse", "expect": None, "toolkit": slug}
            )

    # C. hand-written realistic asks. expect = list of SUBSTRING patterns any one of
    # which must appear in a surfaced key (robust to googlesuper twins / _TRIGGER
    # suffixes). Empty list = catalog genuinely has nothing (honest no-match is right;
    # closest-events alternatives still desirable). None = behavior-only browse row.
    HAND = [
        ("when a new github issue is created", ["GITHUB_ISSUE_CREATED"]),
        ("new github issue opened", ["GITHUB_ISSUE_CREATED", "GITHUB_ISSUE_ADDED"]),
        (
            "when a pull request is merged",
            ["PULL_REQUEST_STATE_CHANGED", "PULL_REQUEST_EVENT"],
        ),
        (
            "github pr merged",
            ["PULL_REQUEST_STATE_CHANGED", "PULL_REQUEST_EVENT", "PR_REVIEW"],
        ),
        ("when someone stars my github repo", ["STAR_ADDED", "STARGAZER"]),
        ("new commit pushed to github", ["GITHUB_COMMIT_EVENT"]),
        (
            "new slack message in a channel",
            ["SLACK_CHANNEL_MESSAGE_RECEIVED", "SLACKBOT_CHANNEL_MESSAGE_RECEIVED"],
        ),
        ("when i get a direct message in slack", ["DIRECT_MESSAGE_RECEIVED"]),
        (
            "slack reaction added to a message",
            ["SLACK_MESSAGE_REACTION_ADDED", "SLACKBOT_MESSAGE_REACTION_ADDED"],
        ),
        ("when a new email arrives in gmail", ["GMAIL_NEW_GMAIL_MESSAGE"]),
        ("new gmail email received", ["GMAIL_NEW_GMAIL_MESSAGE"]),
        ("when a calendar event is about to start", ["EVENT_STARTING_SOON"]),
        ("new event added to google calendar", ["CALENDAR_EVENT_CREATED"]),
        ("when a notion page is created", ["NOTION_PAGE_CREATED"]),
        ("new row added to google sheets", ["NEW_ROWS", "SPREADSHEET_ROW"]),
        (
            "when a linear issue is created",
            ["LINEAR_ISSUE_CREATED", "TEAM_ISSUE_CREATED"],
        ),
        ("new jira ticket created", ["JIRA_NEW_ISSUE"]),
        ("when a typeform gets a new response", ["TYPEFORM_NEW_RESPONSE"]),
        (
            "when a file is uploaded to google drive",
            ["DRIVE_FILE_CREATED", "DRIVE_CHANGES", "NEW_FILE"],
        ),
        ("when a hubspot contact is created", ["HUBSPOT_CONTACT_CREATED"]),
        (
            "when a stripe payment fails",
            ["STRIPE_PAYMENT_FAILED", "STRIPE_CHARGE_FAILED"],
        ),
        ("stripe checkout completed", ["CHECKOUT_SESSION_COMPLETED"]),
        ("when an asana task is completed", ["ASANA_TASK_UPDATED", "ASANA_TASK_MOVED"]),
        ("new trello card added", ["TRELLO_NEW_CARD"]),
        ("discord message received", ["DISCORD_NEW_MESSAGE"]),
        # asks with NO catalog answer: honest no-match is right, closest-events help
        ("when someone mentions the bot in slack", []),
        ("slack mention", []),
        ("new whatsapp message", []),
        ("when a tweet mentions my company", []),
        ("new telegram message received", []),
        ("new file in dropbox", []),
        # browse phrasings agents genuinely type (behavior-only)
        ("slack triggers", None),
        ("github triggers", None),
        ("what events can gmail trigger on", None),
        ("triggers for notion", None),
        # morphology traps
        ("github issues created", ["GITHUB_ISSUE_CREATED"]),
        ("slack trigger", None),
        ("new slack messages", ["CHANNEL_MESSAGE_RECEIVED"]),
        # whole-goal paste (agent includes the action part)
        (
            "send me an email when a new github issue is created",
            ["GITHUB_ISSUE_CREATED"],
        ),
        ("post to slack when a stripe payment fails", None),
        ("summarize new gmail emails every morning", ["GMAIL_NEW_GMAIL_MESSAGE"]),
    ]
    for q, expect in HAND:
        corpus.append({"q": q, "category": "hand", "expect": expect})

    return corpus


# ---------------------------------------------------------------- evaluation


def deprecated_keys(events):
    return {
        e.key
        for e in events
        if (e.description or "").strip().lower().startswith("deprecated")
    }


def evaluate(ns, events, integ_names, corpus):
    dep = deprecated_keys(events)
    stats = defaultdict(lambda: defaultdict(int))
    failures = defaultdict(list)
    hand_detail = []
    for row in corpus:
        cat, q, expect = row["category"], row["q"], row["expect"]
        primary, alts, note = discover(ns, events, integ_names, q, 3)
        s = stats[cat]
        s["n"] += 1
        surfaced_keys = ([primary.key] if primary else []) + [a.key for a in alts]
        surfaced_toolkits = ([primary.integration] if primary else []) + [
            a.integration for a in alts
        ]
        if primary is None and not alts:
            s["empty"] += 1
        if primary is None and alts:
            s["nomatch_with_alts"] += 1
        if primary and primary.key in dep:
            s["deprecated_primary"] += 1
        if any(k in dep for k in surfaced_keys):
            s["deprecated_surfaced"] += 1
        if cat == "hand":
            hand_detail.append(
                (q, primary.key if primary else None, [a.key for a in alts])
            )
        if cat == "browse":
            if row["toolkit"] in surfaced_toolkits:
                s["right_toolkit"] += 1
            elif surfaced_keys:
                s["wrong_toolkit"] += 1
            continue
        if expect is None:
            if surfaced_keys:
                s["got_something"] += 1
            continue

        def hits(key):
            if isinstance(expect, set):
                return key in expect
            return any(p in key for p in expect)

        if not expect:
            if primary is None:
                s["honest_nomatch"] += 1
            else:
                s["false_positive"] += 1
                if len(failures[cat]) < 12:
                    failures[cat].append((q, ["<nothing>"], surfaced_keys[:3]))
            if alts:
                s["nomatch_but_helpful"] += 1
            continue
        if primary and hits(primary.key):
            s["top1"] += 1
        elif any(hits(k) for k in surfaced_keys):
            s["in_top4"] += 1
        else:
            s["miss"] += 1
            if len(failures[cat]) < 12:
                exp_show = sorted(expect)[:2] if isinstance(expect, set) else expect[:2]
                failures[cat].append((q, exp_show, surfaced_keys[:3]))
    return stats, failures, hand_detail


def pct(a, b):
    return f"{100 * a / b:5.1f}%" if b else "    -"


def report(stats):
    for cat in ("usecase", "fragment", "hand", "browse"):
        s = stats[cat]
        n = s["n"]
        if not n:
            continue
        parts = [f"{cat:9s} n={n:4d}"]
        if cat == "browse":
            parts.append(f"right_toolkit={pct(s['right_toolkit'], n)}")
            parts.append(f"wrong_toolkit={pct(s['wrong_toolkit'], n)}")
            parts.append(f"empty={pct(s['empty'], n)}")
        else:
            parts.append(f"top1={pct(s['top1'], n)}")
            parts.append(f"top4={pct(s['top1'] + s['in_top4'], n)}")
            parts.append(f"miss={pct(s['miss'], n)}")
            parts.append(f"empty={pct(s['empty'], n)}")
        if s["honest_nomatch"] or s["false_positive"]:
            parts.append(
                f"honest_nomatch={s['honest_nomatch']} false_pos={s['false_positive']} helpful_alts={s['nomatch_but_helpful']}"
            )
        parts.append(
            f"dep_primary={s['deprecated_primary']} dep_surfaced={s['deprecated_surfaced']}"
        )
        print("  " + "  ".join(parts))


def main():
    ns = load_scorer()
    events, integ_names = load_catalog()
    corpus = build_corpus(events, integ_names)
    print(
        f"catalog: {len(events)} events, {len(integ_names)} toolkits; corpus: {len(corpus)} queries"
    )
    print(f"deprecated events in catalog: {len(deprecated_keys(events))}")

    stats, failures, hand_detail = evaluate(ns, events, integ_names, corpus)
    report(stats)

    if "-v" in sys.argv:
        for cat, rows in failures.items():
            print(f"\n--- misses / false positives [{cat}] ---")
            for q, exp, got in rows:
                print(f"  {q!r}\n    expected {exp} got {got}")
        print("\n--- hand detail ---")
        for q, prim, alts in hand_detail:
            print(f"  {q!r}\n    primary={prim}  alts={alts}")


if __name__ == "__main__":
    main()
