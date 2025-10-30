#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "requests>=2.31.0",
#     "python-dotenv>=1.0.0",
# ]
# ///
"""
Script to retrieve prompt configurations from Agenta deployment.

Usage:
    uv run scripts/get_prompt.py --environment production --app-slug my-app
    uv run scripts/get_prompt.py --environment staging --app-id 019a0b13-7dac-7190-affa-e54d3a5a40d6
    uv run scripts/get_prompt.py --help

Environment Variables:
    AGENTA_API_URL: Agenta API URL (default: https://agenta.bravetech.io)
    AGENTA_BRAVETECH_API_KEY: Agenta API key (loaded from scripts/.env)
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


class AgentaPromptRetriever:
    """Client for retrieving prompt configurations from Agenta."""

    def __init__(self, api_url: str, api_key: Optional[str] = None):
        """
        Initialize the Agenta prompt retriever.

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

    def get_environments(self, app_id: str) -> list:
        """
        Get all environments for an app.

        Args:
            app_id: The ID of the application

        Returns:
            List of environment dictionaries

        Raises:
            Exception: If API error occurs
        """
        url = f"{self.api_url}/api/apps/{app_id}/environments"
        response = requests.get(url, headers=self.headers)
        response.raise_for_status()
        return response.json()

    def get_variant_by_environment(
        self, app_id: str, environment: str
    ) -> Optional[dict]:
        """
        Get the deployed variant for a specific environment.

        Args:
            app_id: The ID of the application
            environment: The environment name (e.g., 'production', 'staging')

        Returns:
            Variant details or None if not found

        Raises:
            Exception: If API error occurs
        """
        environments = self.get_environments(app_id)

        for env in environments:
            if env.get("name") == environment:
                # Get the deployed variant ID from the environment
                deployed_variant_id = env.get("deployed_app_variant_id")
                if not deployed_variant_id:
                    print(
                        f"Warning: No variant deployed to environment '{environment}'",
                        file=sys.stderr,
                    )
                    return None

                # Fetch the variant details
                return self.get_variant(deployed_variant_id)

        raise Exception(f"Environment '{environment}' not found for app {app_id}")

    def get_variant(self, variant_id: str, project_id: Optional[str] = None) -> dict:
        """
        Get variant details by ID.

        Args:
            variant_id: The ID of the variant
            project_id: Optional project ID

        Returns:
            Variant details dictionary

        Raises:
            Exception: If variant not found or API error
        """
        url = f"{self.api_url}/api/variants/{variant_id}"
        params = {}
        if project_id:
            params["project_id"] = project_id
        response = requests.get(url, headers=self.headers, params=params)
        response.raise_for_status()
        return response.json()

    def fetch_config_by_environment(
        self, app_slug: str, environment_slug: str
    ) -> dict:
        """
        Fetch the deployed configuration for an environment (the actual prompt).

        This uses the /variants/configs/fetch endpoint which returns the full
        configuration including the prompt that's deployed to the environment.

        Args:
            app_slug: The slug of the application
            environment_slug: The environment slug (e.g., 'production', 'staging')

        Returns:
            Full configuration including params.prompt with the actual prompt

        Raises:
            Exception: If API error occurs
        """
        url = f"{self.api_url}/api/variants/configs/fetch"
        payload = {
            "environment_ref": {"slug": environment_slug, "id": None},
            "application_ref": {"slug": app_slug, "id": None},
        }
        response = requests.post(url, headers=self.headers, json=payload)
        response.raise_for_status()
        return response.json()

    def get_variant_revisions(
        self, variant_id: str, project_id: Optional[str] = None
    ) -> list:
        """
        Get all revisions for a variant.

        Args:
            variant_id: The ID of the variant
            project_id: Optional project ID

        Returns:
            List of revision dictionaries

        Raises:
            Exception: If API error occurs
        """
        url = f"{self.api_url}/api/variants/{variant_id}/revisions"
        params = {}
        if project_id:
            params["project_id"] = project_id

        response = requests.get(url, headers=self.headers, params=params)
        response.raise_for_status()
        return response.json()

    def get_prompt_config(
        self,
        environment: str,
        app_slug: str,
    ) -> dict:
        """
        Get the prompt configuration for a specific environment.

        Uses the /variants/configs/fetch endpoint which directly returns
        the deployed configuration including the full prompt.

        Args:
            environment: The environment name (e.g., 'production', 'staging')
            app_slug: The slug of the application

        Returns:
            Dictionary containing full prompt configuration

        Raises:
            Exception: If API error occurs
        """
        return self.fetch_config_by_environment(app_slug, environment)


def main():
    """Main entry point for the script."""
    parser = argparse.ArgumentParser(
        description="Retrieve prompt configurations from Agenta deployment",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Get production prompt by app slug
  python scripts/get_prompt.py --environment production --app-slug my-app

  # Get staging prompt by app ID
  python scripts/get_prompt.py --environment staging --app-id 019a0b13-7dac-7190-affa-e54d3a5a40d6

  # Get production prompt with revision history
  python scripts/get_prompt.py --environment production --app-slug my-app --include-revisions

  # Save output to file
  python scripts/get_prompt.py --environment production --app-slug my-app --output prompt.json

Environment Variables:
  AGENTA_API_URL    Agenta API URL (default: https://agenta.bravetech.io)
  AGENTA_API_KEY    Agenta API key (required if authentication is enabled)
        """,
    )

    parser.add_argument(
        "--environment",
        "-e",
        required=True,
        help="Environment name (e.g., production, staging, development)",
    )

    parser.add_argument(
        "--app-slug",
        "-a",
        required=True,
        help="Application slug (e.g., indemnity-lol-review-clause)",
    )

    # Optional arguments
    parser.add_argument(
        "--api-url",
        default=os.getenv("AGENTA_API_URL", "https://agenta.bravetech.io"),
        help="Agenta API URL (default: $AGENTA_API_URL or https://agenta.bravetech.io)",
    )

    parser.add_argument(
        "--api-key",
        default=os.getenv("AGENTA_BRAVETECH_API_KEY") or os.getenv("AGENTA_API_KEY"),
        help="Agenta API key (default: $AGENTA_BRAVETECH_API_KEY or $AGENTA_API_KEY)",
    )


    parser.add_argument(
        "--output",
        "-o",
        help="Output file path (default: print to stdout)",
    )

    parser.add_argument(
        "--pretty",
        action="store_true",
        default=True,
        help="Pretty-print JSON output (default: True)",
    )

    parser.add_argument(
        "--compact",
        action="store_true",
        help="Compact JSON output (overrides --pretty)",
    )

    args = parser.parse_args()

    try:
        # Initialize the retriever
        retriever = AgentaPromptRetriever(
            api_url=args.api_url,
            api_key=args.api_key,
        )

        # Get the prompt configuration
        config = retriever.get_prompt_config(
            environment=args.environment,
            app_slug=args.app_slug,
        )

        # Format output
        if args.compact:
            output = json.dumps(config, separators=(",", ":"))
        elif args.pretty:
            output = json.dumps(config, indent=2, sort_keys=False)
        else:
            output = json.dumps(config)

        # Write output
        if args.output:
            with open(args.output, "w") as f:
                f.write(output)
            print(f"Configuration saved to {args.output}", file=sys.stderr)
        else:
            print(output)

        sys.exit(0)

    except requests.exceptions.HTTPError as e:
        print(f"HTTP Error: {e}", file=sys.stderr)
        if e.response is not None:
            try:
                error_detail = e.response.json()
                print(f"Details: {json.dumps(error_detail, indent=2)}", file=sys.stderr)
            except:
                print(f"Response: {e.response.text}", file=sys.stderr)
        sys.exit(1)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
