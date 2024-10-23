from collections import OrderedDict

from sqlalchemy import Column, UUID, TIMESTAMP, func

from agenta_backend.dbs.postgres.shared.base import Base

## --- DISPLAY --- ##


NOF_CHARS = 8


def _p_id(id):
    return repr(str(id)[:NOF_CHARS])


def _str(o):
    return f"{{ {_p_osa(o)} }}"


def _repr(o):
    return f"{o.__class__.__name__}({_p_ora(o)})"


def _p_osa(o):
    return ", ".join(
        [
            (
                f"{i[0]}: {_p_id(i[1])}"
                if repr(i[1]).startswith("UUID(")
                or (i[0] == "slug" and i[1] is not None)
                else (
                    f"{i[0]}: {i[1].name}"
                    if repr(i[1]).startswith("<")
                    else f"{i[0]}: {repr(i[1])}"
                )
            )
            for i in OrderedDict(
                sorted(o.__dict__.items(), key=lambda item: item[0])
            ).items()
            if not i[0].startswith("_")
        ]
    )


def _p_ora(o):
    return ", ".join(
        [
            (
                f"{i[0]}={str(i[1])}"
                if repr(i[1]).startswith("<")
                else f"{i[0]}={repr(i[1])}"
            )
            for i in OrderedDict(
                sorted(o.__dict__.items(), key=lambda item: item[0])
            ).items()
            if not i[0].startswith("_")
        ]
    )


class DisplayBase:
    __abstract__ = True

    def __str__(self):
        return _str(self)

    def __repr__(self):
        return _repr(self)


## --- SCOPE (DBA) --- ##


class ProjectScopeDBA(DisplayBase):
    __abstract__ = True

    project_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )


## --- LIFECYCLE (DBA) --- ##


class LifecycleDBA(DisplayBase):
    __abstract__ = True

    created_at = Column(
        TIMESTAMP,
        server_default=func.current_timestamp(),
        nullable=False,
    )
    updated_at = Column(
        TIMESTAMP,
        server_onupdate=func.current_timestamp(),
        nullable=True,
    )
    updated_by_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )
