from json import loads, dumps
from typing import Optional, Union, Any, Dict

from opentelemetry.sdk.trace import Span, Status, StatusCode
from opentelemetry.sdk.trace.export import ReadableSpan


def set_status(span: Span, status: str, message: Optional[str] = None) -> None:
    if status == "OK":
        if span.status.status_code != StatusCode.ERROR:
            span.set_status(
                Status(status_code=StatusCode.OK, description=message),
            )
    elif status == "ERROR":
        span.set_status(
            Status(status_code=StatusCode.ERROR, description=message),
        )


def add_event(span: Span, name, attributes=None, timestamp=None) -> None:
    span.add_event(
        name=name,
        attributes=_serialize_attributes(None, attributes),
        timestamp=timestamp,
    )


def record_exception(span: Span, exception, attributes=None, timestamp=None) -> None:
    span.record_exception(
        exception=exception,
        attributes=_serialize_attributes(None, attributes),
        timestamp=timestamp,
        escaped=None,
    )


def set_attributes(
    span: Span, namespace: Optional[str], attributes: Dict[str, Any]
) -> None:
    if isinstance(attributes, dict):
        span.set_attributes(_serialize_attributes(namespace, attributes).items())


def get_attributes(span: Union[ReadableSpan, Span], namespace: str):
    return _deserialize_attributes(
        namespace,
        {
            key: value
            for key, value in span.attributes.items()
            if key != _decode_key(namespace, key)
        },
    )


def _serialize_attributes(
    namespace: str,
    attributes: Dict[str, Any],
) -> Dict[str, str]:
    if not isinstance(attributes, dict):
        return {}

    return {
        _encode_key(namespace, key): _encode_value(value)
        for key, value in attributes.items()
    }


def _deserialize_attributes(
    namespace: str,
    attributes: Dict[str, Any],
) -> Dict[str, Any]:
    if not isinstance(attributes, dict):
        return {}

    return {
        _decode_key(namespace, key): _decode_value(value)
        for key, value in attributes.items()
    }


def _encode_key(namespace: Optional[str] = None, key: str = "") -> str:
    if namespace is None:
        return key

    return f"ag.{namespace}.{key}"


def _decode_key(namespace: Optional[str] = None, key: str = "") -> str:
    if namespace is None:
        return key

    return key.replace(f"ag.{namespace}.", "")


def _encode_value(value: Any) -> Any:
    if value is None:
        value = "@ag.type=none:"
        return value

    if isinstance(value, (str, int, float, bool, bytes)):
        return value

    if isinstance(value, dict) or isinstance(value, list):
        encoded = dumps(value)
        value = "@ag.type=json:" + encoded
        return value

    return repr(value)


def _decode_value(value: Any) -> Any:
    if isinstance(value, (int, float, bool, bytes)):
        return value

    if isinstance(value, str):
        if value == "@ag.type=none:":
            return None

        if value.startswith("@ag.type=json:"):
            encoded = value[len("@ag.type=json:") :]
            value = loads(encoded)
            return value

        return value

    return value
