import requests
import re
import sys
from urllib.parse import urlparse
from pydantic import BaseModel, Field
from typing import Annotated
import agenta as ag
import litellm
from agenta.sdk.assets import supported_llm_models

ag.init()

litellm.drop_params = True
litellm.callbacks = [ag.callbacks.litellm_handler()]

prompt_system = """
You are an expert Python developer performing a file-by-file review of a pull request. You have access to the full diff of the file to understand the overall context and structure. However, focus on reviewing only the specific hunk provided.
"""

prompt_user = """
Here is the diff for the file:
{diff}

Please provide a critique of the changes made in this file.
"""


class Config(BaseModel):
    system_prompt: str = prompt_system
    user_prompt: str = prompt_user
    model: Annotated[str, ag.MultipleChoice(choices=supported_llm_models)] = Field(
        default="gpt-3.5-turbo"
    )


@ag.instrument()
def get_pr_diff(pr_url):
    """
    Fetch the diff for a GitHub Pull Request given its URL.

    Args:
        pr_url (str): Full GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)

    Returns:
        str: The PR diff text

    Raises:
        ValueError: If the URL is invalid
        requests.RequestException: If the API request fails
    """
    # Parse the PR URL to extract owner, repo, and PR number
    pattern = r"github\.com/([^/]+)/([^/]+)/pull/(\d+)"
    match = re.search(pattern, pr_url)

    if not match:
        raise ValueError("Invalid GitHub PR URL format")

    owner, repo, pr_number = match.groups()

    # Construct the API URL for the diff
    api_url = f"https://patch-diff.githubusercontent.com/raw/{owner}/{repo}/pull/{pr_number}.diff"

    # Make the request
    headers = {
        "Accept": "application/vnd.github.v3.diff",
        "User-Agent": "PR-Diff-Fetcher",
    }

    response = requests.get(api_url, headers=headers)
    response.raise_for_status()

    return response.text


@ag.route("/", config_schema=Config)
@ag.instrument()
def generate_critique(pr_url: str):
    diff = get_pr_diff(pr_url)
    config = ag.ConfigManager.get_from_route(schema=Config)
    response = litellm.completion(
        model=config.model,
        messages=[
            {"content": config.system_prompt, "role": "system"},
            {"content": config.user_prompt.format(diff=diff), "role": "user"},
        ],
    )
    return response.choices[0].message.content


if __name__ == "__main__":
    print(generate_critique("https://github.com/Agenta-AI/agenta/pull/2289"))
