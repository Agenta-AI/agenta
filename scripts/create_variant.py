#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "requests>=2.31.0",
#     "python-dotenv>=1.0.0",
# ]
# ///
"""
Script to create a new variant in Agenta deployment.

Usage:
    uv run scripts/create_variant.py --app-slug my-app --variant-slug my-variant --prompt-file prompt.json
    uv run scripts/create_variant.py --help

Environment Variables:
    AGENTA_API_URL: Agenta API URL (default: https://agenta.bravetech.io)
    AGENTA_API_KEY: Agenta API key (loaded from scripts/.env)
    AGENTA_API_KEY: Alternative API key variable
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv

# Load environment variables from scripts/.env
script_dir = Path(__file__).parent
env_file = script_dir / ".env"
if env_file.exists():
    load_dotenv(env_file)


class AgentaVariantCreator:
    """Client for creating variants in Agenta."""

    def __init__(self, api_url: str, api_key: Optional[str] = None):
        """
        Initialize the Agenta variant creator.

        Args:
            api_url: Base URL for the Agenta API
            api_key: Optional API key for authentication
        """
        self.api_url = api_url.rstrip("/")
        self.api_key = api_key
        self.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if self.api_key:
            self.headers["Authorization"] = f"ApiKey {self.api_key}"

    def get_app_by_slug(self, app_slug: str, project_id: Optional[str] = None) -> dict:
        """
        Get app details by slug.

        Args:
            app_slug: The slug of the application
            project_id: Optional project ID filter

        Returns:
            App details dictionary

        Raises:
            Exception: If app not found or API error
        """
        url = f"{self.api_url}/api/apps"
        params = {}
        if project_id:
            params["project_id"] = project_id

        response = requests.get(url, headers=self.headers, params=params)
        response.raise_for_status()

        apps = response.json()
        for app in apps:
            if app.get("app_name") == app_slug or app.get("slug") == app_slug:
                return app

        raise Exception(f"App with slug '{app_slug}' not found")

    def create_variant(
        self, app_slug: str, variant_slug: str
    ) -> dict:
        """
        Create a new variant for an app using configs/add endpoint.

        Args:
            app_slug: The slug of the application
            variant_slug: The slug for the new variant

        Returns:
            Created variant details

        Raises:
            Exception: If API error occurs
        """
        url = f"{self.api_url}/api/variants/configs/add"

        payload = {
            "application_ref": {
                "slug": app_slug,
            },
            "variant_ref": {
                "slug": variant_slug,
            },
        }

        response = requests.post(url, headers=self.headers, json=payload)
        response.raise_for_status()

        return response.json()

    def commit_variant(
        self, app_slug: str, variant_slug: str, app_id: str, variant_id: str, parameters: dict
    ) -> dict:
        """
        Commit changes to a variant using configs/commit endpoint.

        Args:
            app_slug: The slug of the application
            variant_slug: The slug of the variant
            app_id: The ID of the application
            variant_id: The ID of the variant
            parameters: The variant configuration parameters

        Returns:
            Updated variant details

        Raises:
            Exception: If API error occurs
        """
        url = f"{self.api_url}/api/variants/configs/commit"

        # The payload structure matches ConfigRequest (config: ConfigDto)
        # ConfigDto contains params, variant_ref, application_ref, etc.
        # Both slug and id are required for the refs
        payload = {
            "config": {
                "params": parameters,
                "variant_ref": {
                    "slug": variant_slug,
                    "id": variant_id,
                },
                "application_ref": {
                    "slug": app_slug,
                    "id": app_id,
                },
            }
        }

        response = requests.post(url, headers=self.headers, json=payload)
        response.raise_for_status()

        return response.json()


def load_prompt_file(file_path: str) -> dict:
    """
    Load prompt configuration from a JSON file.

    Args:
        file_path: Path to the JSON file

    Returns:
        Prompt configuration dictionary

    Raises:
        Exception: If file not found or invalid JSON
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Prompt file not found: {file_path}")

    with open(path, "r") as f:
        data = json.load(f)

    return data


def convert_prompt_to_parameters(prompt_data: dict) -> dict:
    """
    Convert prompt JSON data to Agenta variant parameters format.

    Args:
        prompt_data: The prompt configuration from JSON

    Returns:
        Parameters dictionary for Agenta API
    """
    # The prompt_data should already be in the correct format
    # with messages, llm_config, template_format, and input_keys
    return {
        "prompt": prompt_data
    }


def main():
    parser = argparse.ArgumentParser(
        description="Create a new variant in Agenta deployment",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Create variant from prompt file
  uv run scripts/create_variant.py \\
    --app-slug contract-review-indemnities-lol \\
    --variant-slug indemnity-gpt5 \\
    --prompt-file indemnity-query.json

  # Specify API URL
  uv run scripts/create_variant.py \\
    --app-slug my-app \\
    --variant-slug my-variant \\
    --prompt-file prompt.json \\
    --api-url https://agenta.bravetech.io
        """,
    )

    parser.add_argument(
        "--app-slug",
        required=True,
        help="Application slug (e.g., contract-review-indemnities-lol)",
    )
    parser.add_argument(
        "--variant-slug",
        required=True,
        help="Variant slug/name (e.g., indemnity-gpt5)",
    )
    parser.add_argument(
        "--prompt-file",
        required=True,
        help="Path to JSON file containing prompt configuration",
    )
    parser.add_argument(
        "--api-url",
        default=os.getenv("AGENTA_API_URL", "https://agenta.bravetech.io"),
        help="Agenta API URL (default: $AGENTA_API_URL or https://agenta.bravetech.io)",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("AGENTA_API_KEY") or os.getenv("AGENTA_API_KEY"),
        help="Agenta API key (default: $AGENTA_API_KEY or $AGENTA_API_KEY)",
    )
    parser.add_argument(
        "--project-id",
        help="Optional project ID filter",
    )
    parser.add_argument(
        "--commit-only",
        action="store_true",
        help="Commit to existing variant instead of creating new one",
    )

    args = parser.parse_args()

    try:
        # Load prompt configuration
        print(f"Loading prompt from: {args.prompt_file}")
        prompt_data = load_prompt_file(args.prompt_file)
        parameters = convert_prompt_to_parameters(prompt_data)

        # Initialize client
        client = AgentaVariantCreator(api_url=args.api_url, api_key=args.api_key)

        # Verify app exists
        print(f"Verifying app exists: {args.app_slug}")
        app = client.get_app_by_slug(args.app_slug, args.project_id)
        print(f"Found app: {app['app_name']} (ID: {app['app_id']})")

        # Create the variant first (this creates an empty variant)
        print(f"Creating variant: {args.variant_slug}")
        create_result = client.create_variant(
            app_slug=args.app_slug,
            variant_slug=args.variant_slug,
        )
        print(f"✓ Variant created: {args.variant_slug}")

        # Extract the IDs from the create result
        variant_id = create_result.get("variant_ref", {}).get("id")
        app_id_from_result = create_result.get("application_ref", {}).get("id", app["app_id"])

        if not variant_id:
            print("ERROR: Could not get variant ID from create result")
            print(json.dumps(create_result, indent=2))
            sys.exit(1)

        # Now commit the parameters to the variant
        print(f"Committing parameters to variant (ID: {variant_id})...")
        commit_result = client.commit_variant(
            app_slug=args.app_slug,
            variant_slug=args.variant_slug,
            app_id=app_id_from_result,
            variant_id=variant_id,
            parameters=parameters,
        )

        print("\n✓ Variant created and configured successfully!")
        print(f"  App: {args.app_slug}")
        print(f"  Variant: {args.variant_slug}")
        if "variant_ref" in commit_result:
            print(f"  Version: {commit_result['variant_ref'].get('version', 'N/A')}")
        print(f"\nVariant details:")
        print(json.dumps(commit_result, indent=2))

    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.RequestException as e:
        print(f"API Error: {e}", file=sys.stderr)
        if hasattr(e, "response") and e.response is not None:
            try:
                error_detail = e.response.json()
                print(f"Details: {json.dumps(error_detail, indent=2)}", file=sys.stderr)
            except:
                print(f"Response: {e.response.text}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
