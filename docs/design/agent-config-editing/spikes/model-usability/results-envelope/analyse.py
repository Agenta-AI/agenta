import collections
import glob
import json

rows = []
for path in glob.glob("*.jsonl"):
    for line in open(path):
        r = json.loads(line)
        r["_file"] = path
        rows.append(r)


def pct(a, b):
    return f"{a}/{b}" + (f" ({100 * a // b}%)" if b else "")


print("=== ENVELOPE TASKS (e1, e2): first-attempt facts ===")
print(
    f"{'model':16} {'arm':16} {'n':>3}  {'valid-1st':>10} {'desc top':>9} {'nested':>7} {'base id':>8} {'correct':>8}"
)


def key(r):
    return (r["model"], r.get("surface", "?"))


env = [r for r in rows if r["task"] in ("e1", "e2")]
for (model, arm), group in sorted(collections.Counter(map(key, env)).items()):
    g = [r for r in env if key(r) == (model, arm)]
    n = len(g)

    def e(field):
        return sum(bool((r.get("first_call_envelope") or {}).get(field)) for r in g)

    print(
        f"{model:16} {arm:16} {n:>3}  {pct(sum(bool(r.get('first_call_valid')) for r in g), n):>10}"
        f" {pct(e('description_top_level'), n):>9} {pct(e('description_nested'), n):>7}"
        f" {pct(e('base_revision_id_present'), n):>8} {pct(sum(r['correct'] for r in g), n):>8}"
    )

ops = [r for r in rows if r["task"] not in ("e1", "e2")]
if ops:
    print("\n=== OPERATION TASKS (shipped surface): regression ===")
    for model in sorted({r["model"] for r in ops}):
        g = [r for r in ops if r["model"] == model]
        n = len(g)
        base = sum(
            bool((r.get("first_call_envelope") or {}).get("base_revision_id_present"))
            for r in g
        )
        print(
            f"  {model:16} n={n:<4} correct {pct(sum(r['correct'] for r in g), n)}"
            f"  first_call_valid {pct(sum(bool(r.get('first_call_valid')) for r in g), n)}"
            f"  base id sent {pct(base, n)}"
        )
        bad = [r for r in g if not r["correct"]]
        for r in bad[:6]:
            print(f"      {r['task']} trial {r['trial']}: {r['error']}")

tin = sum(r["input_tokens"] for r in rows)
tout = sum(r["output_tokens"] for r in rows)
print(f"\ntrials {len(rows)}   tokens in {tin:,} out {tout:,}")
