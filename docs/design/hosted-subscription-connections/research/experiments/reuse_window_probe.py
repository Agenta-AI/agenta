# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Measure how long a rotated-away ChatGPT refresh token keeps working.

  --arm   : refresh once with the credential in --codex-auth, write the NEW credential back to the
            given files, and stash the OLD refresh token (mode 0600) with a timestamp in --stash.
  --check : try the stashed old token again. Prints age and status. On 200 it discards the extra
            tokens it got (they are not written anywhere).
No token is printed. Only sha256 fingerprints, ages, and statuses.
"""
from __future__ import annotations
import argparse, hashlib, json, os, time
import requests
TOKEN_URL = "https://auth.openai.com/oauth/token"
CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
def fp(t): return hashlib.sha256(t.encode()).hexdigest()[:8]
def refresh(rt):
    r = requests.post(TOKEN_URL, data={"grant_type":"refresh_token","refresh_token":rt,"client_id":CLIENT_ID}, timeout=30)
    try: b = r.json()
    except ValueError: b = {}
    return r.status_code, b
ap = argparse.ArgumentParser(); ap.add_argument("--codex-auth"); ap.add_argument("--stash", required=True)
ap.add_argument("--arm", action="store_true"); ap.add_argument("--check", action="store_true")
ap.add_argument("--write-back", action="append", default=[]); ap.add_argument("--pi-write-back", action="append", default=[])
a = ap.parse_args(); stash = os.path.expanduser(a.stash)
if a.arm:
    doc = json.load(open(os.path.expanduser(a.codex_auth))); old = doc["tokens"]["refresh_token"]; acc = doc["tokens"]["account_id"]
    s, b = refresh(old); print("arm refresh:", s, "old=", fp(old), "new=", fp(b.get("refresh_token","")) if s==200 else b.get("error"))
    if s != 200: raise SystemExit(1)
    json.dump({"old_refresh": old, "rotated_at": time.time(), "old_fp": fp(old), "new_fp": fp(b["refresh_token"])}, open(stash, "w")); os.chmod(stash, 0o600)
    for p in a.write_back:
        p = os.path.expanduser(p); d = json.load(open(p)); d["tokens"].update(access_token=b["access_token"], refresh_token=b["refresh_token"], id_token=b.get("id_token", d["tokens"].get("id_token")))
        d["last_refresh"] = time.strftime("%Y-%m-%dT%H:%M:%S.000000000Z", time.gmtime()); json.dump(d, open(p, "w"), indent=2); os.chmod(p, 0o600); print("wrote", p)
    for p in a.pi_write_back:
        p = os.path.expanduser(p); d = json.load(open(p)) if os.path.exists(p) else {}
        d["openai-codex"] = {"type":"oauth","access":b["access_token"],"refresh":b["refresh_token"],"expires":int(time.time()*1000)+int(b.get("expires_in",0))*1000,"accountId":acc}
        json.dump(d, open(p, "w"), indent=2); os.chmod(p, 0o600); print("wrote", p)
if a.check:
    st = json.load(open(stash)); age = time.time() - st["rotated_at"]; s, b = refresh(st["old_refresh"])
    print(f"check: old={st['old_fp']} age={age/60:.1f}min status={s} " + (f"new={fp(b['refresh_token'])} (discarded)" if s==200 else f"error={ {k:b.get(k) for k in ('error','code','error_description')} }"))
