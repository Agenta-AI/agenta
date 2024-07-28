# This file was copied from the backend, because SDK cannot depend on the backend.
# At best, both depend on a third thing we could call core, outside of the backend.

"""
encode_json converts a Python object to a JSON-friendly dict
(e.g. datetimes to strings, Pydantic models to dicts).

Taken from FastAPI, and made a bit simpler
https://github.com/tiangolo/fastapi/blob/master/fastapi/encoders.py
"""

import dataclasses
import datetime as dt
from collections import defaultdict
from enum import Enum
from pathlib import PurePath
from types import GeneratorType
from typing import Any, Callable, Dict, List, Optional, Set, Tuple, Union

try:
    import pydantic.v1 as pydantic  # type: ignore
except ImportError:
    import pydantic  # type: ignore

import datetime as dt


def serialize_datetime(v: dt.datetime) -> str:
    """
    Serialize a datetime including timezone info.

    Uses the timezone info provided if present, otherwise uses the current runtime's timezone info.

    UTC datetimes end in "Z" while all other timezones are represented as offset from UTC, e.g. +05:00.
    """

    def _serialize_zoned_datetime(v: dt.datetime) -> str:
        if v.tzinfo is not None and v.tzinfo.tzname(None) == dt.timezone.utc.tzname(
            None
        ):
            # UTC is a special case where we use "Z" at the end instead of "+00:00"
            return v.isoformat().replace("+00:00", "Z")
        else:
            # Delegate to the typical +/- offset format
            return v.isoformat()

    if v.tzinfo is not None:
        return _serialize_zoned_datetime(v)
    else:
        local_tz = dt.datetime.now(dt.timezone.utc).astimezone().tzinfo
        localized_dt = v.replace(tzinfo=local_tz)
        return _serialize_zoned_datetime(localized_dt)


SetIntStr = Set[Union[int, str]]
DictIntStrAny = Dict[Union[int, str], Any]


def generate_encoders_by_class_tuples(
    type_encoder_map: Dict[Any, Callable[[Any], Any]]
) -> Dict[Callable[[Any], Any], Tuple[Any, ...]]:
    encoders_by_class_tuples: Dict[Callable[[Any], Any], Tuple[Any, ...]] = defaultdict(
        tuple
    )
    for type_, encoder in type_encoder_map.items():
        encoders_by_class_tuples[encoder] += (type_,)
    return encoders_by_class_tuples


encoders_by_class_tuples = generate_encoders_by_class_tuples(
    pydantic.json.ENCODERS_BY_TYPE
)


def encode_json(
    obj: Any, custom_encoder: Optional[Dict[Any, Callable[[Any], Any]]] = None
) -> Any:
    custom_encoder = custom_encoder or {}
    if custom_encoder:
        if type(obj) in custom_encoder:
            return custom_encoder[type(obj)](obj)
        else:
            for encoder_type, encoder_instance in custom_encoder.items():
                if isinstance(obj, encoder_type):
                    return encoder_instance(obj)

    if isinstance(obj, pydantic.BaseModel):
        encoder = getattr(obj.__config__, "json_encoders", {})
        if custom_encoder:
            encoder.update(custom_encoder)
        obj_dict = obj.dict(by_alias=True)
        if "__root__" in obj_dict:
            obj_dict = obj_dict["__root__"]
        return encode_json(obj_dict, custom_encoder=encoder)

    if dataclasses.is_dataclass(obj):
        obj_dict = dataclasses.asdict(obj)
        return encode_json(obj_dict, custom_encoder=custom_encoder)

    if isinstance(obj, Enum):
        return obj.value

    if isinstance(obj, PurePath):
        return str(obj)

    if isinstance(obj, (str, int, float, type(None))):
        return obj

    if isinstance(obj, dt.date):
        return str(obj)

    if isinstance(obj, dt.datetime):
        return serialize_datetime(obj)

    if isinstance(obj, dict):
        encoded_dict = {}
        allowed_keys = set(obj.keys())
        for key, value in obj.items():
            if key in allowed_keys:
                encoded_key = encode_json(key, custom_encoder=custom_encoder)
                encoded_value = encode_json(value, custom_encoder=custom_encoder)
                encoded_dict[encoded_key] = encoded_value
        return encoded_dict

    if isinstance(obj, (list, set, frozenset, GeneratorType, tuple)):
        encoded_list = []
        for item in obj:
            encoded_list.append(encode_json(item, custom_encoder=custom_encoder))
        return encoded_list

    if type(obj) in pydantic.json.ENCODERS_BY_TYPE:
        return pydantic.json.ENCODERS_BY_TYPE[type(obj)](obj)

    for encoder, classes_tuple in encoders_by_class_tuples.items():
        if isinstance(obj, classes_tuple):
            return encoder(obj)

    try:
        data = dict(obj)
    except Exception as e:
        errors: List[Exception] = []
        errors.append(e)
        try:
            data = repr(obj)  # DIFFERENT
        except Exception as e:
            errors.append(e)
            raise ValueError(errors) from e
    return encode_json(data, custom_encoder=custom_encoder)