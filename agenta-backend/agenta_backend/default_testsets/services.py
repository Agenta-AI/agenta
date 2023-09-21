import os
import json
from typing import Dict
from pathlib import Path


def get_single_prompt_testsets() -> Dict[str, str]:
    """Reads and returns the contents of a JSON file as a list of
    dictionaries.

    Returns:
        Dict[str, str]: dictionary of csv data
    """

    parent_directory = Path(os.path.dirname(__file__)).parent
    working_directory = "default_testsets"
    with open(
        f"{parent_directory}/{working_directory}/single_prompt_testsets.json",
        "r",
    ) as f:
        json_data = json.loads(f.read())
    return json_data["single_prompt"]
