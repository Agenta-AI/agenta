#!/usr/bin/env python3
"""Full harness x sandbox matrix smoke. Each cell: invoke via FastAPI, the agent writes a
cell-unique file into its geesefs cwd, then verify durability in SeaweedFS host-side
(signed GET via the fastapi container). Prints a PASS/FAIL grid.

Usage:  python3 matrix_test.py [sandbox...] [--harness h1,h2]
  python3 matrix_test.py                 # local daytona modal e2b  x  all 4 harnesses
  python3 matrix_test.py local           # just local
  python3 matrix_test.py daytona --harness opencode,pi

daytona requires Tier 3+ egress and a built snapshot (node sidecar/daytona_snapshot.js).
"""

import json
import subprocess
import sys
import urllib.request

API = "http://localhost:8000"
# valid (harness -> provider, model) per the discovered adapter vocab
MODEL = {
    "claude": "sonnet",
    "codex": "gpt-5.4",
    "opencode": "anthropic/claude-sonnet-4-6",
    "pi": "anthropic/claude-sonnet-4-6",
}
PROV = {
    "claude": "anthropic",
    "codex": "openai",
    "opencode": "anthropic",
    "pi": "anthropic",
}

argv = [a for a in sys.argv[1:]]
harnesses = ["claude", "codex", "opencode", "pi"]


def _take_flag(name, default):
    if name not in argv:
        return default
    i = argv.index(name)
    if i + 1 >= len(argv):
        sys.exit(f"{name} requires a value")
    val = argv[i + 1]
    del argv[i : i + 2]
    return val


harnesses = _take_flag("--harness", ",".join(harnesses)).split(",")
REASONING = _take_flag("--reasoning", "none")
sandboxes = argv or ["local", "daytona", "modal", "e2b"]


def invoke(sandbox, harness, file, tag):
    body = json.dumps(
        {
            "prompt": f"Create a file named {file} containing exactly: {tag} ok. Then stop.",
            "sandbox": sandbox,
            "harness": harness,
            "provider": PROV[harness],
            "model": MODEL[harness],
            "reasoning": REASONING,
        }
    ).encode()
    req = urllib.request.Request(
        API + "/invoke", data=body, headers={"content-type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=320) as r:
            o = json.loads(r.read())
        return o.get("session_id", ""), (o.get("stop_reason") or "no-stop")
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:120]
        return "", f"HTTP{e.code}:{detail}"
    except Exception as e:
        return "", f"ERR:{str(e)[:100]}"


def durable(sid, file):
    if not sid:
        return False
    code = f"""
import asyncio,aioboto3,os
async def m():
 s=aioboto3.Session()
 async with s.client('s3',endpoint_url=os.environ['SEAWEEDFS_S3_URL'],aws_access_key_id=os.environ['SEAWEEDFS_S3_ACCESS_KEY'],aws_secret_access_key=os.environ['SEAWEEDFS_S3_SECRET_KEY'],region_name='us-east-1') as s3:
  try:
   await s3.get_object(Bucket=os.environ['SEAWEEDFS_S3_BUCKET'],Key='{sid}/{file}'); print('YES')
  except Exception: print('NO')
asyncio.run(m())
"""
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "fastapi", "python", "-c", code],
        capture_output=True,
        text=True,
        cwd=".",
    )
    return "YES" in out.stdout


results = {}
for sb in sandboxes:
    for hn in harnesses:
        tag = f"{sb}_{hn}"
        file = f"proof_{tag}.txt"
        print(f"── invoke {sb} × {hn} ──", flush=True)
        sid, stop = invoke(sb, hn, file, tag)
        ok = durable(sid, file)
        results[tag] = (stop, ok)
        print(
            f"   -> stop={stop} durable={'YES' if ok else 'NO'} sid={sid[:8]}",
            flush=True,
        )

print(f"\n========= MATRIX (durable agent write?) · reasoning={REASONING} =========")
hdr = "sandbox\\harness"
print(f"{hdr:<16}" + "".join(f"{h:<11}" for h in harnesses))
for sb in sandboxes:
    row = f"{sb:<16}"
    for hn in harnesses:
        stop, ok = results.get(f"{sb}_{hn}", ("", False))
        row += f"{'PASS' if ok else 'FAIL':<11}"
    print(row)

# detail lines for any failures
fails = {k: v for k, v in results.items() if not v[1]}
if fails:
    print("\nfailures:")
    for k, (stop, _) in fails.items():
        print(f"  {k}: {stop}")
