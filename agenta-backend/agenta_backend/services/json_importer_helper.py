import json


def get_json(json_path: str):
    """Reads and returns the contents of a JSON file as a list of
    dictionaries.

    Args:
                json_path (str): The path of json
    """

    with open(json_path) as f:
        json_data = json.loads(f.read())
    return json_data
