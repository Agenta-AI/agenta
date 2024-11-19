from typing import Optional, List, Tuple, Union
from datetime import datetime
from uuid import UUID

from sqlalchemy import and_, or_, not_, distinct, Column, func, cast
from sqlalchemy import TIMESTAMP, Enum, UUID as SQLUUID, Integer, Numeric
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.future import select
from sqlalchemy.dialects import postgresql

from agenta_backend.dbs.postgres.shared.engine import engine
from agenta_backend.dbs.postgres.observability.dbes import NodesDBE
from agenta_backend.dbs.postgres.observability.mappings import (
    map_span_dto_to_dbe,
    map_span_dbe_to_dto,
)

from agenta_backend.core.observability.interfaces import ObservabilityDAOInterface
from agenta_backend.core.observability.dtos import QueryDTO, SpanDTO
from agenta_backend.core.observability.dtos import (
    FilteringDTO,
    ConditionDTO,
    LogicalOperator,
    ComparisonOperator,
    NumericOperator,
    StringOperator,
    ListOperator,
    ExistenceOperator,
)
from agenta_backend.core.observability.utils import FilteringException
from agenta_backend.core.observability.utils import (
    _is_uuid_key,
    _is_literal_key,
    _is_integer_key,
    _is_float_key,
    _is_datetime_key,
    _is_string_key,
)


class ObservabilityDAO(ObservabilityDAOInterface):
    def __init__(self):
        pass

    async def query(
        self,
        *,
        project_id: UUID,
        #
        query_dto: QueryDTO,
    ) -> Tuple[List[SpanDTO], Optional[int]]:
        try:
            async with engine.session() as session:
                # BASE (SUB-)QUERY
                query = select(NodesDBE)
                # ----------------

                # GROUPING
                grouping = query_dto.grouping
                grouping_column: Optional[Column] = None
                # --------
                if grouping and grouping.focus.value != "node":
                    grouping_column = getattr(
                        NodesDBE,
                        grouping.focus.value + "_id",
                    )

                    query = select(
                        distinct(grouping_column).label("grouping_key"),
                        NodesDBE.created_at,
                    )
                # --------

                # SCOPING
                query = query.filter_by(
                    project_id=project_id,
                )
                # -------

                # WINDOWING
                windowing = query_dto.windowing
                # ---------
                if windowing:
                    if windowing.oldest:
                        query = query.filter(NodesDBE.created_at >= windowing.oldest)

                    if windowing.newest:
                        query = query.filter(NodesDBE.created_at < windowing.newest)
                # ---------

                # FILTERING
                filtering = query_dto.filtering
                # ---------
                if filtering:
                    operator = filtering.operator
                    conditions = filtering.conditions

                    query = query.filter(
                        _combine(
                            operator,
                            _filters(conditions),
                        )
                    )
                # ---------

                # SORTING
                query = query.order_by(
                    NodesDBE.created_at.desc(),
                )
                # -------

                # COUNTING // dangerous with large datasets
                count_query = select(
                    func.count()  # pylint: disable=E1102:not-callable
                ).select_from(query.subquery())

                count = (await session.execute(count_query)).scalar()
                # --------

                # PAGINATION
                pagination = query_dto.pagination
                # ----------
                if pagination:
                    query = _chunk(
                        query,
                        **pagination.model_dump(),
                    )
                # ----------

                # GROUPING
                if grouping and grouping_column:
                    subquery = query.subquery()

                    query = select(NodesDBE)
                    query = query.filter(
                        grouping_column.in_(select(subquery.c["grouping_key"]))
                    )

                    # SORTING
                    query = query.order_by(
                        NodesDBE.created_at.desc(),
                        NodesDBE.time_start.asc(),
                    )
                    # -------
                else:
                    # SORTING
                    query = query.order_by(
                        NodesDBE.time_start.desc(),
                    )
                    # -------
                # --------

                # DEBUGGING
                # TODO: HIDE THIS BEFORE RELEASING
                print(
                    str(
                        query.compile(
                            dialect=postgresql.dialect(),
                            compile_kwargs={"literal_binds": True},
                        )
                    )
                )
                # ---------

                # QUERY EXECUTION
                spans = (await session.execute(query)).scalars().all()
                # ---------------

            return [map_span_dbe_to_dto(span) for span in spans], count
        except AttributeError as e:
            raise FilteringException(
                "Failed to run query due to non-existent key(s)."
            ) from e

    async def create_one(
        self,
        *,
        project_id: UUID,
        span_dto: SpanDTO,
    ) -> None:
        span_dbe = map_span_dto_to_dbe(
            project_id=project_id,
            span_dto=span_dto,
        )

        async with engine.session() as session:
            session.add(span_dbe)
            await session.commit()

    async def create_many(
        self,
        *,
        project_id: UUID,
        span_dtos: List[SpanDTO],
    ) -> None:
        span_dbes = [
            map_span_dto_to_dbe(
                project_id=project_id,
                span_dto=span_dto,
            )
            for span_dto in span_dtos
        ]

        async with engine.session() as session:
            for span_dbe in span_dbes:
                session.add(span_dbe)

            await session.commit()

    async def read_one(
        self,
        *,
        project_id: UUID,
        node_id: UUID,
        to_dto: bool = True,
    ) -> Union[Optional[SpanDTO], Optional[NodesDBE]]:
        span_dbe = None
        async with engine.session() as session:
            query = select(NodesDBE)

            query = query.filter_by(
                project_id=project_id,
                node_id=node_id,
            )

            span_dbe = (await session.execute(query)).scalars().one_or_none()

        span_dto = None
        if span_dbe and to_dto:
            span_dto = map_span_dbe_to_dto(span_dbe)

            return span_dto

        return span_dbe

    async def read_many(
        self,
        *,
        project_id: UUID,
        node_ids: List[UUID],
        to_dto: bool = True,
    ) -> Union[List[SpanDTO], List[NodesDBE]]:
        span_dbes = []
        async with engine.session() as session:
            query = select(NodesDBE)

            query = query.filter_by(project_id=project_id)

            query = query.filter(NodesDBE.node_id.in_(node_ids))

            span_dbes = (await session.execute(query)).scalars().all()

        span_dtos = []
        if span_dbes and to_dto:
            span_dtos = [map_span_dbe_to_dto(span_dbe) for span_dbe in span_dbes]

            return span_dtos

        return span_dbes

    async def read_children(
        self,
        *,
        project_id: UUID,
        parent_id: UUID,
        to_dto: bool = True,
    ) -> Union[List[SpanDTO], List[NodesDBE]]:
        span_dbes = []
        async with engine.session() as session:
            query = select(NodesDBE)

            query = query.filter_by(project_id=project_id)

            query = query.filter_by(parent_id=parent_id)

            span_dbes = (await session.execute(query)).scalars().all()

        span_dtos = []
        if span_dbes and to_dto:
            span_dtos = [map_span_dbe_to_dto(span_dbe) for span_dbe in span_dbes]

            return span_dtos

        return span_dbes

    async def delete_one(
        self,
        *,
        project_id: UUID,
        node_id: UUID,
    ) -> None:
        span_dbe = await self.read_one(
            project_id=project_id,
            node_id=node_id,
            to_dto=False,
        )

        if span_dbe:
            # COULD BE REPLACED WITH A CASCADE
            children_dbes = await self.read_children(
                project_id=project_id,
                parent_id=node_id,
                to_dto=False,
            )

            if children_dbes:
                await self.delete_many(
                    project_id=project_id,
                    node_ids=[child_dbe.node_id for child_dbe in children_dbes],
                )
            # --------------------------------

            async with engine.session() as session:
                await session.delete(span_dbe)
                await session.commit()

    async def delete_many(
        self,
        *,
        project_id: UUID,
        node_ids: List[UUID],
    ) -> None:
        span_dbes = await self.read_many(
            project_id=project_id,
            node_ids=node_ids,
            to_dto=False,
        )

        if span_dbes:
            for span_dbe in span_dbes:
                # COULD BE REPLACED WITH A CASCADE
                children_dbes = await self.read_children(
                    project_id=project_id,
                    parent_id=span_dbe.node_id,
                    to_dto=False,
                )

                if children_dbes:
                    await self.delete_many(
                        project_id=project_id,
                        node_ids=[child_dbe.node_id for child_dbe in children_dbes],
                    )
                # --------------------------------

                async with engine.session() as session:
                    await session.delete(span_dbe)
                    await session.commit()


def _chunk(
    query: select,
    page: Optional[int] = None,
    size: Optional[int] = None,
    next: Optional[datetime] = None,  # pylint: disable=W0621:redefined-builtin
    stop: Optional[datetime] = None,
) -> select:
    # 1. LIMIT size OFFSET (page - 1) * size
    # -> unstable if windowing.newest is not set
    if page and size:
        limit = size
        offset = (page - 1) * size

        query = query.limit(limit).offset(offset)

    # 2. WHERE next > created_at LIMIT size
    # -> unstable if created_at is not unique
    elif next and size:
        query = query.filter(NodesDBE.created_at < next)
        query = query.limit(size)

    # 3. WHERE next > created_at AND created_at >= stop
    # -> stable thanks to the </<= combination
    elif next and stop:
        query = query.filter(NodesDBE.created_at < next)
        query = query.filter(NodesDBE.created_at >= stop)

    # 4. WHERE LIMIT size
    # -> useful as a starter query
    elif size:
        query = query.limit(size)

    # 5. WHERE created_at >= stop
    # -> useful as a starter query
    elif stop:
        query = query.filter(NodesDBE.created_at >= stop)

    # 6. WHERE next > created_at
    # -> rather useless
    elif next:
        query = query.filter(NodesDBE.created_at < next)

    return query


def _combine(
    operator: LogicalOperator,
    conditions: list,
):
    if operator == LogicalOperator.AND:
        return and_(*conditions)
    elif operator == LogicalOperator.OR:
        return or_(*conditions)
    elif operator == LogicalOperator.NOT:
        return not_(and_(*conditions))
    else:
        raise ValueError(f"Unknown operator: {operator}")


_FLAT_KEYS = {
    "time.start": "time_start",
    "time.end": "time_end",
    "root.id": "root_id",
    "tree.id": "tree_id",
    "tree.type": "tree_type",
    "node.id": "node_id",
    "node.type": "node_type",
    "node.name": "node_name",
    "parent.id": "parent_id",
}

_NESTED_FIELDS = ("data",)


def _filters(filtering: FilteringDTO) -> list:
    _conditions = []

    for condition in filtering:
        if isinstance(condition, FilteringDTO):
            _conditions.append(
                _combine(
                    condition.operator,
                    _filters(
                        condition.conditions,
                    ),
                )
            )

        elif isinstance(condition, ConditionDTO):
            _key = condition.key
            value = condition.value

            # MAP FLAT KEYS
            if _key in _FLAT_KEYS:
                _key = _FLAT_KEYS[_key]

            # SPLIT FIELD AND KEY
            _split = _key.split(".", 1)
            field = _split[0]
            key = _split[1] if len(_split) > 1 else None

            # GET COLUMN AS ATTRIBUTE
            attribute: Column = getattr(NodesDBE, field)

            if isinstance(attribute.type, JSONB) and key:
                if field in _NESTED_FIELDS:
                    key = key.split(".")

                    for k in key[-1]:
                        attribute = attribute[k]

                attribute = attribute[key].astext

                # CASTING
                if _is_uuid_key(_key):
                    attribute = cast(attribute, SQLUUID)
                elif _is_literal_key(_key):
                    pass
                elif _is_integer_key(_key):
                    attribute = cast(attribute, Integer)
                elif _is_float_key(_key):
                    attribute = cast(attribute, Numeric)
                elif _is_datetime_key(_key):
                    pass
                elif _is_string_key(_key):
                    pass
                else:
                    pass

            if isinstance(attribute.type, TIMESTAMP):
                value = datetime.fromisoformat(value)

            if isinstance(attribute.type, Enum):
                value = str(value).upper()

            # COMPARISON OPERATORS
            if isinstance(condition.operator, ComparisonOperator):
                if condition.operator == ComparisonOperator.IS:
                    _conditions.append(attribute == value)
                elif condition.operator == ComparisonOperator.IS_NOT:
                    _conditions.append(attribute != value)

            # NUMERIC OPERATORS
            elif isinstance(condition.operator, NumericOperator):
                if condition.operator == NumericOperator.EQ:
                    _conditions.append(attribute == value)
                elif condition.operator == NumericOperator.NEQ:
                    _conditions.append(attribute != value)
                elif condition.operator == NumericOperator.GT:
                    _conditions.append(attribute > value)
                elif condition.operator == NumericOperator.LT:
                    _conditions.append(attribute < value)
                elif condition.operator == NumericOperator.GTE:
                    _conditions.append(attribute >= value)
                elif condition.operator == NumericOperator.LTE:
                    _conditions.append(attribute <= value)
                elif condition.operator == NumericOperator.BETWEEN:
                    _conditions.append(attribute.between(value[0], value[1]))

            # STRING OPERATORS
            elif isinstance(condition.operator, StringOperator):
                if condition.operator == StringOperator.STARTSWITH:
                    _conditions.append(attribute.startswith(value))
                elif condition.operator == StringOperator.ENDSWITH:
                    _conditions.append(attribute.endswith(value))
                elif condition.operator == StringOperator.CONTAINS:
                    _conditions.append(attribute.contains(value))
                elif condition.operator == StringOperator.LIKE:
                    _conditions.append(attribute.like(value))
                elif condition.operator == StringOperator.MATCHES:
                    if condition.options:
                        case_sensitive = condition.options.case_sensitive
                        exact_match = condition.options.exact_match
                    else:
                        case_sensitive = False
                        exact_match = False

                    if exact_match:
                        if case_sensitive:
                            _conditions.append(attribute.like(value))
                        else:
                            _conditions.append(attribute.ilike(value))
                    else:
                        pattern = f"%{value}%"
                        if case_sensitive:
                            _conditions.append(attribute.like(pattern))
                        else:
                            _conditions.append(attribute.ilike(pattern))

            # LIST OPERATORS
            elif isinstance(condition.operator, ListOperator):
                if condition.operator == ListOperator.IN:
                    _conditions.append(attribute.in_(value))

            # EXISTENCE OPERATORS
            elif isinstance(condition.operator, ExistenceOperator):
                if condition.operator == ExistenceOperator.EXISTS:
                    _conditions.append(attribute.isnot(None))
                elif condition.operator == ExistenceOperator.NOT_EXISTS:
                    _conditions.append(attribute.is_(None))

    return _conditions
