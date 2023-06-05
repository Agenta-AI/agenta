from typing import Any, List, MutableMapping

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
