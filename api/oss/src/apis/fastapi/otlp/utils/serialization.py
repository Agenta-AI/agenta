from decimal import Decimal, InvalidOperation
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
    "ag.agent.": "agent",
}


def process_attribute(attribute: Tuple[str, Any], prefix: str) -> Dict[str, Any]:
    """Process a single attribute (key, value) by removing the prefix to the key and decoding the value."""
    return {remove_prefix(prefix, attribute[0]): decode_value(attribute[1])}


def json_parse_loses_data(text: str) -> bool:
    """True when parsing `text` as JSON drops digits or duplicate object keys.

    Invalid JSON returns False: nothing parses it, so nothing is lost.
    """
    lossy = False

    def parse_float(literal: str) -> float:
        nonlocal lossy
        number = float(literal)
        try:
            if Decimal(repr(number)) != Decimal(literal):
                lossy = True
        except InvalidOperation:
            lossy = True
        return number

    def parse_constant(literal: str) -> float:
        nonlocal lossy
        lossy = True
        return float(literal)

    def object_pairs_hook(pairs: list) -> dict:
        nonlocal lossy
        parsed = dict(pairs)
        if len(parsed) != len(pairs):
            lossy = True
        return parsed

    try:
        loads(
            text,
            parse_float=parse_float,
            parse_constant=parse_constant,
            object_pairs_hook=object_pairs_hook,
        )
    except (JSONDecodeError, TypeError, ValueError):
        return False

    return lossy


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
