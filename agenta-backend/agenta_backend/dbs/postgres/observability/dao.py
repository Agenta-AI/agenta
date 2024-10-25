from typing import Optional, List
from datetime import datetime

from sqlalchemy import and_, or_, not_, distinct, Column, cast
from sqlalchemy import UUID, String, Float, Boolean, TIMESTAMP, Enum
from sqlalchemy.dialects.postgresql import HSTORE, JSON, JSONB
from sqlalchemy.future import select
from sqlalchemy.dialects import postgresql

from agenta_backend.dbs.postgres.shared.engine import engine
from agenta_backend.dbs.postgres.observability.dbes import InvocationSpanDBE
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


class ObservabilityDAO(ObservabilityDAOInterface):
    def __init__(self):
        pass

    async def query(
        self,
        *,
        project_id: UUID,
        #
        query_dto: QueryDTO,
    ) -> List[SpanDTO]:
        async with engine.session() as session:
            # BASE (SUB-)QUERY
            query = select(InvocationSpanDBE)
            # ----------------

            # GROUPING
            grouping = query_dto.grouping
            grouping_column: Optional[Column] = None
            # --------
            if grouping and grouping.focus.value != "node":
                grouping_column = getattr(
                    InvocationSpanDBE, grouping.focus.value + "_id"
                )

                query = select(
                    distinct(grouping_column).label("grouping_key"),
                    InvocationSpanDBE.created_at,
                )
            # --------

            # SCOPING
            query = query.filter_by(project_id=project_id)
            # -------

            # WINDOWING
            windowing = query_dto.windowing
            # ---------
            if windowing:
                if windowing.earliest:
                    query = query.filter(
                        InvocationSpanDBE.time_start >= windowing.earliest
                    )

                if windowing.latest:
                    query = query.filter(InvocationSpanDBE.time_end <= windowing.latest)
            # ---------

            # FILTERING
            filtering = query_dto.filtering
            # ---------
            if filtering:
                operator = filtering.operator
                conditions = filtering.conditions

                query = query.filter(_combine(operator, _filters(conditions)))
            # ---------

            # SORTING
            if grouping and grouping_column:
                query = query.order_by(grouping_column)
            query = query.order_by(InvocationSpanDBE.created_at.desc())
            # -------

            # PAGINATION
            pagination = query_dto.pagination
            # ----------
            if pagination:
                limit = pagination.size
                offset = (pagination.page - 1) * pagination.size

                query = query.limit(limit).offset(offset)
            # ----------

            # GROUPING
            if grouping and grouping_column:
                subquery = query.subquery()

                query = select(InvocationSpanDBE)
                query = query.filter(
                    grouping_column.in_(select(subquery.c["grouping_key"]))
                )
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

        return [map_span_dbe_to_dto(span) for span in spans]

    async def create_one(
        self,
        *,
        project_id: UUID,
        #
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
        #
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
        node_id: str,
        to_dto: bool = True,
    ) -> Optional[SpanDTO]:
        span_dbe = None
        async with engine.session() as session:
            query = select(InvocationSpanDBE)

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
        node_ids: List[str],
        to_dto: bool = True,
    ) -> List[SpanDTO]:
        span_dbes = []
        async with engine.session() as session:
            query = select(InvocationSpanDBE)

            query = query.filter_by(project_id=project_id)

            query = query.filter(InvocationSpanDBE.node_id.in_(node_ids))

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
        node_id: str,
    ) -> None:
        span_dbe = self.read_one(
            project_id=project_id,
            node_id=node_id,
            to_dto=False,
        )

        if span_dbe:
            async with engine.session() as session:
                session.delete(span_dbe)
                await session.commit()

    async def delete_many(
        self,
        *,
        project_id: UUID,
        node_ids: List[str],
    ) -> None:
        span_dbes = self.read_many(
            project_id=project_id,
            node_ids=node_ids,
            to_dto=False,
        )

        if span_dbes:
            async with engine.session() as session:
                for span in span_dbes:
                    session.delete(span)

                await session.commit()


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
            key = condition.key
            value = condition.value

            # MAP FLAT KEYS
            if key in _FLAT_KEYS:
                key = _FLAT_KEYS[key]

            # SPLIT FIELD AND KEY
            _split = key.split(".", 1)
            field = _split[0]
            key = _split[1] if len(_split) > 1 else None

            # GET COLUMN AS ATTRIBUTE
            attribute: Column = getattr(InvocationSpanDBE, field)

            # Handle JSON/JSONB/HSTORE key-paths
            # Assumption: JSON/JSONB/HSTORE columns are stored flat even when nested
            if key:
                if isinstance(attribute.type, (JSON, JSONB, HSTORE)):
                    if isinstance(attribute.type, HSTORE):
                        attribute = attribute[key]
                        value = str(value)
                    else:
                        attribute = attribute[key].astext

                        if isinstance(value, UUID):
                            attribute = cast(attribute, UUID)
                        elif isinstance(value, str):
                            attribute = cast(attribute, String)
                            value = f'"{value}"'
                        elif isinstance(value, int):
                            attribute = cast(attribute, Float)  # Yes, Float
                        elif isinstance(value, float):
                            attribute = cast(attribute, Float)
                        elif isinstance(value, bool):
                            attribute = cast(attribute, Boolean)

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
