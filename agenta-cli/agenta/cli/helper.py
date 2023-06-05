from pathlib import Path
from typing import Any, List, MutableMapping

import toml
from agenta.client import client
from agenta.client.api_models import AppVariant


def update_variants_from_backend(app_name: str,
                                 config: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    """Reads the list of variants from the backend and updates the config accordingly

    Arguments:
        app_name -- the app name
        config -- the config loaded using toml.load

    Returns:
        a new config object later to be saved using toml.dump(config, config_file.open('w'))
    """
    variants: List[AppVariant] = client.list_variants(app_name)
    config['variants'] = [variant.variant_name for variant in variants]
    return config


def update_config_from_backend(config_file: Path):
    """Updates the config file with new information from the backend

    Arguments:
        config_file -- the path to the config file
    """
    assert config_file.exists(), "Config file does not exist!"
    config = toml.load(config_file)
    app_name = config['app-name']
    if 'variants' not in config:
        config['variants'] = []
    config = update_variants_from_backend(app_name, config)
    toml.dump(config, config_file.open('w'))
