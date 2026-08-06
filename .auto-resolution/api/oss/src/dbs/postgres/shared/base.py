from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm import registry


reg = registry()


class Base(DeclarativeBase):
    registry = reg
