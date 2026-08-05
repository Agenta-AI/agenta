"""Create (or update) the CV screening app in Agenta and deploy it to production.

This is the robust, idempotent alternative to `create_app.py`. It talks to the
HTTP API directly to work around the SDK/endpoint gaps that otherwise break a
completion app (see `AGENTS.md` in this folder):

1. Every revision it writes carries `data.uri = "agenta:builtin:completion:v0"`,
   which is what the playground needs to invoke the prompt. The SDK managers
   leave the uri null, so the playground shows a 404 instead of running.
2. It creates the artifact and a variant named `default` explicitly, instead of
   `POST /simple/applications/`, which auto-names the variant with an ugly hex
   slug, and instead of `VariantManager.create`, which leaves an empty orphan
   variant beside the real one.
3. It commits and deploys by **explicit variant id**, never relying on the
   "current variant" auto-resolution. That resolution picks the variant with
   the most recent revision, which can be a stale or archived one, and silently
   commits/deploys the wrong variant.
4. It deploys with `POST /applications/revisions/deploy`, which writes the
   per-app reference map the environment needs. The legacy SDK deploy path
   writes a broken environment revision that fails on fetch.
5. It archives any other (non-`default`) variants and their tip revisions, so a
   project that was previously set up with an auto-named variant ends up clean.

Usage:
    python setup_app.py
"""

import os

import requests
from dotenv import load_dotenv

from config import APP_SLUG, PROMPT_CONFIG, VARIANT_SLUG

COMPLETION_URI = "agenta:builtin:completion:v0"


def _client():
    load_dotenv()
    host = os.environ.get("AGENTA_HOST", "https://cloud.agenta.ai").rstrip("/")
    key = os.environ["AGENTA_API_KEY"]
    session = requests.Session()
    session.headers.update(
        {"Content-Type": "application/json", "Authorization": f"ApiKey {key}"}
    )
    return session, host


def _post(session, host, path, payload):
    response = session.post(f"{host}{path}", json=payload, timeout=60)
    response.raise_for_status()
    return response.json()


def find_application_id(session, host):
    result = _post(
        session,
        host,
        "/api/applications/query",
        {"application_refs": [{"slug": APP_SLUG}]},
    )
    apps = result.get("applications") or []
    return apps[0]["id"] if apps else None


def list_variants(session, host):
    result = _post(
        session,
        host,
        "/api/applications/variants/query",
        {"application_refs": [{"slug": APP_SLUG}]},
    )
    return result.get("application_variants") or []


def variant_tip_revision_id(session, host, variant_id):
    result = _post(
        session,
        host,
        "/api/applications/revisions/log",
        {"application": {"application_variant_id": variant_id}},
    )
    revisions = result.get("application_revisions") or []
    return revisions[0]["id"] if revisions else None


def main() -> None:
    session, host = _client()
    data = {"uri": COMPLETION_URI, "parameters": PROMPT_CONFIG}

    application_id = find_application_id(session, host)
    if application_id is None:
        print(f"Creating application '{APP_SLUG}' ...")
        application_id = _post(
            session,
            host,
            "/api/applications/",
            {"application": {"slug": APP_SLUG, "name": "CV Screening"}},
        )["application"]["id"]

    variants = list_variants(session, host)
    variant_id = next(
        (v["id"] for v in variants if v.get("slug") == VARIANT_SLUG), None
    )
    if variant_id is None:
        print(f"Creating variant '{VARIANT_SLUG}' ...")
        variant_id = _post(
            session,
            host,
            "/api/applications/variants/",
            {
                "application_variant": {
                    "application_id": application_id,
                    "slug": VARIANT_SLUG,
                }
            },
        )["application_variant"]["id"]

    print(f"Committing the prompt to variant '{VARIANT_SLUG}' ({variant_id}) ...")

    def commit():
        return _post(
            session,
            host,
            "/api/applications/revisions/commit",
            {
                "application_revision_commit": {
                    "application_variant_id": variant_id,
                    "data": data,
                    "message": "CV screening prompt with completion URI",
                }
            },
        )["application_revision"]

    # The very first commit on a freshly created variant lands on its empty
    # v0 placeholder and drops the data; a second commit takes. Re-commit
    # until the revision actually carries the completion uri.
    revision = commit()
    if (revision.get("data") or {}).get("uri") != COMPLETION_URI:
        revision = commit()
    print(
        f"  committed version {revision['version']} (uri set: "
        f"{(revision.get('data') or {}).get('uri') == COMPLETION_URI})."
    )

    print(f"Deploying variant '{VARIANT_SLUG}' to production ...")
    _post(
        session,
        host,
        "/api/applications/revisions/deploy",
        {
            "application_variant_ref": {"id": variant_id},
            "environment_ref": {"slug": "production"},
        },
    )

    # Clean up any auto-named variants (and their tip revisions) so the app
    # shows only `default`. Archiving the variant alone leaves its latest
    # revision in the UI history with an ugly id-based name.
    for variant in variants:
        if variant.get("slug") == VARIANT_SLUG:
            continue
        other_id = variant["id"]
        print(f"Archiving stray variant '{variant.get('slug')}' ({other_id}) ...")
        tip = variant_tip_revision_id(session, host, other_id)
        if tip is not None:
            _post(session, host, f"/api/applications/revisions/{tip}/archive", {})
        _post(session, host, f"/api/applications/variants/{other_id}/archive", {})

    print(f"Done. '{APP_SLUG}' is deployed to production and opens in the playground.")


if __name__ == "__main__":
    main()
