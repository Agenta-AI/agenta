from typing import Any, Optional, Dict, Tuple
from json import dumps, loads, JSONDecodeError
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

NAMESPACE_PREFIX_FEATURE_MAPPING = {
    "ag.data.": "data",
    "ag.metrics.": "metrics",
    "ag.flags.": "flags",
    "ag.meta.": "meta",
    "ag.refs.": "refs",
    "ag.type.": "type",
    "ag.links.": "links",
    "ag.exception.": "exception",
    "ag.session.": "session",
    "ag.user.": "user",
}


def process_attribute(attribute: Tuple[str, Any], prefix: str) -> Dict[str, Any]:
    """Process a single attribute (key, value) by removing the prefix to the key and decoding the value."""
    return {remove_prefix(prefix, attribute[0]): decode_value(attribute[1])}


def remove_prefix(prefix: str, key: str):
    """Decode a prefixd key by removing the prefix prefix.
    Example: ag.meta.request.model -> request.model
    """
    if key.startswith(prefix):
        return key[len(prefix) :]
    return key


def decode_key(namespace, key: str):
    """Decode a namespaced key by removing the namespace prefix.
    Example: ag.meta.request.model -> request.model
    """
    prefix = f"{namespace}."
    if key.startswith(prefix):
        return key[len(prefix) :]
    return key


def decode_value(
    value: Any,
) -> Any:
    """
    Decodes a value of a span attribute as one single element unmarshalled
    """
    if isinstance(value, (int, float, bool, bytes)):
        return value

    if isinstance(value, str):
        if value == "@ag.type=none:":
            return None

        if value.startswith("@ag.type=json:"):
            encoded = value[len("@ag.type=json:") :]
            value = loads(encoded)
            return value
        try:
            value = value
        except JSONDecodeError:
            pass
        return value
    return value


def encode_key(
    namespace,
    key: str,
) -> str:
    """
    Encodes a namespaced key by adding the namespace prefix.
    Example: namespace: meta, key: request.model -> ag.meta.request.model
    """
    return f"ag.{namespace}.{key}"


def encode_value(
    value: Any,
) -> Optional[Any]:
    """
    Used in observability SDK to encode the value of of a dict span attribute as one single element unmarshalled
    """
    if value is None:
        return None

    if isinstance(value, (str, int, float, bool, bytes)):
        return value

    if isinstance(value, dict) or isinstance(value, list):
        encoded = dumps(value)
        value = "@ag.type=json:" + encoded
        return value

    return repr(value)
