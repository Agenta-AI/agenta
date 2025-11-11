from json import loads, dumps
from typing import Optional, Union, Sequence, Any, Dict

Primitive = Union[str, int, float, bool, bytes]
PrimitivesSequence = Sequence[Primitive]
Attribute = Union[Primitive, PrimitivesSequence]


def _marshal(
    unmarshalled: Dict[str, Any],
    *,
    parent_key: Optional[str] = "",
    depth: Optional[int] = 0,
    max_depth: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Marshals a dictionary of unmarshalled attributes into a flat dictionary

    Example:
    unmarshalled = {
        "ag": {
            "type": "tree",
            "node": {
                "name": "root",
                "children": [
                    {
                        "name": "child1",
                    },
                    {
                        "name": "child2",
                    }
                ]
            }
        }
    }
    marshalled = {
        "ag.type": "tree",
        "ag.node.name": "root",
        "ag.node.children.0.name": "child1",
        "ag.node.children.1.name": "child2"
    }
    """
    marshalled = {}

    # If max_depth is set and we've reached it,
    # just return the unmarshalled attributes
    if max_depth is not None and depth >= max_depth:
        marshalled[parent_key] = unmarshalled
        # MISSING ENCODING TO JSON IF NOT PRIMITIVE

        return marshalled

    # Otherwise,
    # iterate over the unmarshalled attributes and marshall them
    for key, value in unmarshalled.items():
        child_key = f"{parent_key}.{key}" if parent_key else key

        if isinstance(value, dict):
            dict_key = child_key

            marshalled.update(
                _marshal(
                    value,
                    parent_key=dict_key,
                    depth=depth + 1,
                    max_depth=max_depth,
                )
            )
        elif isinstance(value, list):
            if max_depth is not None and depth + 1 >= max_depth:
                marshalled[child_key] = value
                # MISSING ENCODING TO JSON IF NOT PRIMITIVE
            else:
                for i, item in enumerate(value):
                    list_key = f"{child_key}.{i}"

                    if isinstance(item, (dict, list)):
                        marshalled.update(
                            _marshal(
                                item,
                                parent_key=list_key,
                                depth=depth + 1,
                                max_depth=max_depth,
                            )
                        )
                    else:
                        marshalled[list_key] = item
                        # MISSING ENCODING TO JSON IF NOT PRIMITIVE
        else:
            marshalled[child_key] = value
            # MISSING ENCODING TO JSON IF NOT PRIMITIVE

    return marshalled


def _encode_key(
    namespace: Optional[str] = None,
    key: str = "",
) -> str:
    if namespace is None:
        return key

    return f"ag.{namespace}.{key}"


def _make_serializable(value: Any) -> Any:
    """
    Transform complex nested structures into JSON-serializable form.
    Handles Pydantic models, nested dictionaries and lists recursively.
    """
    if value is None or isinstance(value, (str, int, float, bool, bytes)):
        return value

    # Handle Pydantic objects (prioritize v2 over v1 API)
    if hasattr(value, "model_dump"):  # Pydantic v2
        return value.model_dump()
    elif hasattr(value, "dict"):  # Pydantic v1
        return value.dict()

    if isinstance(value, dict):
        try:
            # Test serialization without modifying - optimizes for already-serializable dicts
            dumps(
                value
            )  # If serialization fails, we'll catch the exception and process deeply
            return value  # Avoid unnecessary recursion for serializable dicts
        except TypeError:
            return {k: _make_serializable(v) for k, v in value.items()}
    elif isinstance(value, list):
        try:
            # Test serialization without modifying - optimizes for already-serializable lists
            dumps(
                value
            )  # If serialization fails, we'll catch the exception and process deeply
            return value  # Avoid unnecessary recursion for serializable lists
        except TypeError:
            return [_make_serializable(item) for item in value]

    return repr(value)


def _encode_value(value: Any) -> Optional[Attribute]:
    """
    Encode values for tracing, ensuring proper JSON serialization.
    Adds the @ag.type=json: prefix only to appropriate values.
    """
    if value is None:
        return None

    if isinstance(value, (str, int, float, bool, bytes)):
        return value

    try:
        if (
            isinstance(value, (dict, list))
            or hasattr(value, "model_dump")
            or hasattr(value, "dict")
        ):
            serializable_value = _make_serializable(value)
            return "@ag.type=json:" + dumps(serializable_value)
    except TypeError:
        pass

    return repr(value)


def serialize(
    *,
    namespace: str,
    attributes: Dict[str, Any],
    max_depth: Optional[int] = None,
) -> Dict[str, str]:
    if not isinstance(attributes, dict):
        return {}

    _attributes = {
        k: v
        for k, v in {
            _encode_key(namespace, key): _encode_value(value)
            for key, value in _marshal(attributes, max_depth=max_depth).items()
        }.items()
        if v is not None
    }

    return _attributes
