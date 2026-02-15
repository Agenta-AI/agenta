import json


def get_json(json_path: str):
    """Reads and returns the contents of a JSON file as a list of
    dictionaries.

    Args:
                json_path (str): The path of json
    """

    with open(json_path) as f:
        try:
            json_data = json.loads(f.read())
        except json.JSONDecodeError as e:
            raise ValueError(f"Could not parse JSON file: {json_path}") from e
        except Exception as e:
            raise ValueError(f"Could not read JSON file: {json_path}") from e
    return json_data
