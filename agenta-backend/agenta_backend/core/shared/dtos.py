from typing import Optional

from pydantic import BaseModel
from uuid import UUID
from datetime import datetime
from enum import Enum
from collections import OrderedDict


## --- DISPLAY --- ##


NOF_CHARS = 8


def _p_id(id):
    return repr(str(id)[:NOF_CHARS])


def _p_osa(o):
    elements = []

    for i in OrderedDict(sorted(o.items())).items():
        if not i[0].startswith("_"):
            if i[1].__class__.__module__ != "builtins":
                if repr(i[1]).startswith("<"):
                    elements.append(f"{i[0]}: {i[1].name}")
                elif repr(i[1]).startswith("UUID("):
                    elements.append(f"{i[0]}: {_p_id(i[1])}")
                else:
                    elements.append(f"{i[0]}: {i[1].__str__()}")
            else:
                if isinstance(i[1], list):
                    elements.append(
                        f"{i[0]}: [" + ", ".join([el.__str__() for el in i[1]]) + "]"
                    )
                elif isinstance(i[1], dict):
                    elements.append(f"{i[0]}: {{{_p_osa(i[1])}}}")
                else:
                    if i[1] is not None:
                        if i[0] == "slug":
                            elements.append(f"{i[0]}: {repr(i[1][:8])}")
                        else:
                            elements.append(f"{i[0]}: {repr(i[1])}")

    return ", ".join(elements)


def _p_ora(o, open="{", close="}", sep=": ", foo=repr):
    if o.__class__.__module__ != "builtins":
        if o.__class__.__name__ == "UUID":
            return repr(o)
        if isinstance(o, Enum):
            return o
        if isinstance(o, datetime):
            return o.isoformat()
        return f"{o.__class__.__name__}({_p_ora(o.__dict__, open='', close='', sep='=', foo=lambda x : x)})"
    elif isinstance(o, list):
        return f"[{', '.join([repr(el) for el in o])}]"
    elif isinstance(o, dict):
        o = OrderedDict(sorted(o.items()))
        return f"{open}{', '.join([f'{foo(elk)}{sep}{_p_ora(elv)}' for elk, elv in o.items()])}{close}"
    else:
        if o is not None:
            return repr(o)


def _str(o):
    return f"{{{_p_osa(o.__dict__)}}}"


def _repr(o):
    return _p_ora(o)


class DisplayBase(BaseModel):
    def __str__(self):
        return _str(self)

    def __repr__(self):
        return _repr(self)


## --- SCOPE --- ##


class ProjectScopeDTO(DisplayBase):
    project_id: UUID


## --- LIFECYCLE --- ##


class LifecycleDTO(DisplayBase):
    created_at: datetime
    updated_at: Optional[datetime] = None

    updated_by_id: Optional[UUID] = None
