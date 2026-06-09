"""Create the CV screening prompt in Agenta and deploy it to production.

Creates a completion application, commits the screening prompt (job spec,
scoring instructions, and structured-output JSON schema) as a variant,
and deploys it to the production environment.

Requires AGENTA_API_KEY (and AGENTA_HOST for self-hosted) in the
environment or in a .env file.

Usage:
    python create_app.py
"""

import agenta as ag
from dotenv import load_dotenv

from config import APP_SLUG, PROMPT_CONFIG, VARIANT_SLUG

load_dotenv()


def main() -> None:
    ag.init()

    print(f"Creating application '{APP_SLUG}' ...")
    try:
        ag.AppManager.create(app_slug=APP_SLUG, app_type="SERVICE:completion")
    except Exception as exc:  # noqa: BLE001 - app may already exist
        print(f"  Application not created ({exc}); assuming it already exists.")

    print(f"Committing prompt to variant '{VARIANT_SLUG}' ...")
    try:
        variant = ag.VariantManager.create(
            parameters=PROMPT_CONFIG,
            app_slug=APP_SLUG,
            variant_slug=VARIANT_SLUG,
        )
    except Exception:
        # The variant already exists: commit a new version instead.
        variant = ag.VariantManager.commit(
            parameters=PROMPT_CONFIG,
            app_slug=APP_SLUG,
            variant_slug=VARIANT_SLUG,
        )
    print(f"  Committed version {variant['variant_version']}.")

    print("Deploying to production ...")
    ag.DeploymentManager.deploy(
        app_slug=APP_SLUG,
        variant_slug=VARIANT_SLUG,
        environment_slug="production",
    )
    print(
        f"Done. Open the '{APP_SLUG}' app in Agenta to edit the prompt "
        "in the playground."
    )


if __name__ == "__main__":
    main()
