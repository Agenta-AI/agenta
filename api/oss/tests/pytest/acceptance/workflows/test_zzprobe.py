import json
from uuid import uuid4


def test_probe(authed_api):
    marker = uuid4().hex[:8]
    slug = uuid4()
    r = authed_api("POST", "/workflows/", json={"workflow": {
        "slug": f"workflow-{slug}", "name": f"W {slug}",
        "flags": {"is_application": True, "is_evaluator": False, "is_snippet": False},
        "tags": {"_marker": marker}}})
    wid = r.json()["workflow"]["id"]
    vslug = uuid4()
    r = authed_api("POST", "/workflows/variants/", json={"workflow_variant": {
        "slug": f"v-{vslug}", "name": f"V {vslug}",
        "flags": {"is_application": True, "is_evaluator": False, "is_snippet": False},
        "workflow_id": wid}})
    vid = r.json()["workflow_variant"]["id"]

    for i in range(3):
        rslug = uuid4()
        r = authed_api("POST", "/workflows/revisions/commit", json={"workflow_revision": {
            "slug": f"r-{rslug}", "name": f"R {rslug}",
            "tags": {"_marker": marker, "i": str(i)},
            "flags": {"is_custom": True, "is_agent": False},
            "data": {"uri": "agenta:builtin:chat:v0", "parameters": {"n": i}},
            "workflow_id": wid, "workflow_variant_id": vid}})
        print("commit", i, r.status_code, r.text[:300], r.json().get("workflow_revision", {}).get("version"),
              r.json().get("workflow_revision", {}).get("id"))

    r = authed_api("POST", "/workflows/revisions/query", json={"workflow_refs": [{"id": wid}]})
    body = r.json()
    print("UNFLAGGED count", body["count"], "keys", list(body.keys()))
    for rev in body["workflow_revisions"]:
        print("  ", rev["version"], rev["id"], "data" if rev.get("data") else "nodata", rev.get("flags"))

    r = authed_api("POST", "/workflows/revisions/query", json={
        "workflow_refs": [{"id": wid}], "workflow_revision": {"latest_per_artifact": True}})
    body = r.json()
    print("FLAGGED count", body["count"], "keys", list(body.keys()))
    for rev in body["workflow_revisions"]:
        print("  ", rev["version"], rev["id"])


def test_probe_multivariant(authed_api):
    slug = uuid4()
    r = authed_api("POST", "/workflows/", json={"workflow": {
        "slug": f"workflow-{slug}", "name": f"W {slug}",
        "flags": {"is_application": True, "is_evaluator": False, "is_snippet": False}}})
    wid = r.json()["workflow"]["id"]

    def mkvariant():
        vslug = uuid4()
        r = authed_api("POST", "/workflows/variants/", json={"workflow_variant": {
            "slug": f"v-{vslug}", "name": f"V {vslug}",
            "flags": {"is_application": True, "is_evaluator": False, "is_snippet": False},
            "workflow_id": wid}})
        return r.json()["workflow_variant"]["id"]

    v1 = mkvariant()
    for i in range(2):
        rslug = uuid4()
        authed_api("POST", "/workflows/revisions/commit", json={"workflow_revision": {
            "slug": f"r-{rslug}", "name": f"R {rslug}",
            "flags": {"is_custom": True, "is_agent": True},
            "data": {"uri": "agenta:builtin:chat:v0", "parameters": {"n": i}},
            "workflow_id": wid, "workflow_variant_id": v1}})
    v2 = mkvariant()

    r = authed_api("POST", "/workflows/revisions/query", json={"workflow_refs": [{"id": wid}]})
    body = r.json()
    print("MV UNFLAGGED", body["count"])
    for rev in body["workflow_revisions"]:
        print("   v=", rev["version"], rev["id"], "variant", rev.get("workflow_variant_id"),
              "data" if rev.get("data") else "NODATA", "flags" if rev.get("flags") else "NOFLAGS")

    r = authed_api("POST", "/workflows/revisions/query", json={
        "workflow_refs": [{"id": wid}], "workflow_revision": {"latest_per_artifact": True}})
    body = r.json()
    print("MV FLAGGED", body["count"])
    for rev in body["workflow_revisions"]:
        print("   v=", rev["version"], rev["id"], "is_agent", (rev.get("flags") or {}).get("is_agent"))
