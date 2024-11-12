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


def _encode_value(
    value: Any,
) -> Optional[Attribute]:
    if value is None:
        return None

    if isinstance(value, (str, int, float, bool, bytes)):
        return value

    if isinstance(value, dict) or isinstance(value, list):
        encoded = dumps(value)
        value = "@ag.type=json:" + encoded
        return value

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
