from typing import Optional, List

from sqlalchemy import and_, or_, not_, Column

from sqlalchemy.future import select
from sqlalchemy import distinct


from agenta_backend.dbs.postgres.shared.engine import engine
from agenta_backend.dbs.postgres.observability.dbes import InvocationSpanDBE
from agenta_backend.dbs.postgres.observability.mappings import (
    map_span_create_dto_to_dbe,
    map_span_dbe_to_dto,
)

from agenta_backend.core.observability.interfaces import ObservabilityDAOInterface
from agenta_backend.core.observability.dtos import QueryDTO
from agenta_backend.core.observability.dtos import (
    FilteringDTO,
    ConditionDTO,
    LogicalOperator,
    NumericOperator,
    StringOperator,
    ListOperator,
    ExistenceOperator,
)
from agenta_backend.core.observability.dtos import (
    SpanDTO,
    SpanCreateDTO,
)


## TODO
# - [ ] Implement Observability Query
#    - [x] Implement grouping node/tree/link/ref
#    - [x] Implement pagination page/size
#    - [x] Implement filtering
#    - [ ] Implement sorting
#    - [ ] Optimize filtering (and schema/queries in general)
#    - [ ] Implement cross-table querying (later ?)
## ----

## TODO
# - [ ] Implement Observability Mutation
#    - [x] Implement create one/many
#    - [x] Implement read one/many
#    - [x] Implement delete one/many
#    - [ ] Implement update one/many (immutable ?)
## ----


class ObservabilityDAO(ObservabilityDAOInterface):
    def __init__(self):
        pass

    async def query(
        self,
        *,
        project_id: str,
        #
        query_dto: QueryDTO,
    ) -> List[SpanDTO]:

        async with engine.session() as session:

            # opts = {
            #    "dialect": dialect(),
            #    "compile_kwargs": {"literal_binds": True},
            # }

            # BASE (SUB-)QUERY
            # print("------------------------------------------------------")
            # print("BASE (SUB-)QUERY")
            query = select(InvocationSpanDBE)
            # ----------------
            # print("...")
            # print(query.statement.compile(**opts))

            # GROUPING
            # print("------------------------------------------------------")
            # print("GROUPING")
            grouping = query_dto.grouping
            grouping_column: Optional[Column] = None
            # --------
            if grouping and grouping.focus.value != "node":
                # print("GROUPING FOCUS:", grouping.focus.value)
                grouping_column = getattr(
                    InvocationSpanDBE, grouping.focus.value + "_id"
                )

                query = select(distinct(grouping_column))
            # --------
            # print("...")
            # print(query.statement.compile(**opts))

            # SCOPING
            # print("------------------------------------------------------")
            # print("SCOPING")
            # -------
            query = query.filter_by(project_id=project_id)
            # -------
            # print("...")
            # print(query.statement.compile(**opts))

            # WINDOWING
            # print("------------------------------------------------------")
            # print("WINDOWING")
            windowing = query_dto.windowing
            windowing_column: Optional[Column] = InvocationSpanDBE.created_at
            # ---------
            if windowing:
                # print("WINDOWING EARLIEST:", windowing.earliest)
                # print("WINDOWING LATEST:  ", windowing.latest)
                if windowing.earliest:
                    query = query.filter(windowing_column >= windowing.earliest)

                if windowing.latest:
                    query = query.filter(windowing_column <= windowing.latest)
            # ---------
            # print("...")
            # print(query.statement.compile(**opts))

            # FILTERING
            # print("------------------------------------------------------")
            # print("FILTERING")
            filtering = query_dto.filtering
            # ---------
            if filtering:
                # print("FILTERING OPERATOR:  ", filtering.operator)
                # print("FILTERING CONDITIONS:", filtering.conditions)
                operator = filtering.operator
                conditions = filtering.conditions

                query = query.filter(_combine(operator, _filters(conditions)))
            # ---------
            # print("...")
            # print(query.statement.compile(**opts))

            # SORTING
            # print("------------------------------------------------------")
            # print("SORTING")
            if grouping and grouping_column:
                query = query.order_by(grouping_column)
            query = query.order_by(windowing_column.desc())

            # -------
            # print("...")
            # print(query.statement.compile(**opts))

            # PAGINATION
            # print("------------------------------------------------------")
            # print("PAGINATION")
            pagination = query_dto.pagination
            # ----------
            if pagination:
                # print("PAGINATION PAGE:", pagination.page)
                # print("PAGINATION SIZE:", pagination.size)
                limit = pagination.size
                offset = (pagination.page - 1) * pagination.size

                query = query.limit(limit).offset(offset)
            # ----------
            # print("...")
            # print(query.statement.compile(**opts))

            # GROUPING
            # print("------------------------------------------------------")
            # print("GROUPING")
            if grouping and grouping_column:
                print("GROUPING FOCUS:", grouping.focus.value)
                subquery = query  # .subquery()

                query = select(InvocationSpanDBE)
                query = query.filter(grouping_column.in_(subquery))
            # --------
            # print("...")
            # print(query.statement.compile(**opts))

            # QUERY EXECUTION
            # print("------------------------------------------------------")
            # rint("QUERY EXECUTION")
            spans = (await session.execute(query)).all()
            # ---------------

            # FORMATTING
            # formatting = query_dto.formatting
            # --------

        # return []
        return [map_span_dbe_to_dto(span) for span in spans]

    async def create_one(
        self,
        *,
        span_dto: SpanCreateDTO,
    ) -> None:
        span_dbe = map_span_create_dto_to_dbe(span_dto)

        async with engine.session() as session:
            session.add(span_dbe)
            session.commit()

    async def create_many(
        self,
        *,
        span_dtos: List[SpanCreateDTO],
    ) -> None:
        span_dbes = [map_span_create_dto_to_dbe(span_dto) for span_dto in span_dtos]

        async with engine.session() as session:
            for span_dbe in span_dbes:
                session.add(span_dbe)

            session.commit()

    async def read_one(
        self,
        *,
        project_id: str,
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

            span_dbe = (await session.execute(query)).one_or_none()

        span_dto = None
        if span_dbe and to_dto:
            span_dto = map_span_dbe_to_dto(span_dbe)

            return span_dto

        return span_dbe

    async def read_many(
        self,
        *,
        project_id: str,
        node_ids: List[str],
        to_dto: bool = True,
    ) -> List[SpanDTO]:
        span_dbes = []
        async with engine.session() as session:
            query = select(InvocationSpanDBE)

            query = query.filter_by(project_id=project_id)

            query = query.filter(InvocationSpanDBE.node_id.in_(node_ids))

            span_dbes = (await session.execute(query)).all()

        span_dtos = []
        if span_dbes and to_dto:
            span_dtos = [map_span_dbe_to_dto(span_dbe) for span_dbe in span_dbes]

            return span_dtos

        return span_dbes

    async def delete_one(
        self,
        *,
        project_id: str,
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
                session.commit()

    async def delete_many(
        self,
        *,
        project_id: str,
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

                session.commit()


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
            column: Column = getattr(InvocationSpanDBE, condition.field)

            # NUMERIC OPERATORS
            if isinstance(condition.operator, NumericOperator):
                if condition.operator == NumericOperator.EQ:
                    _conditions.append(column == condition.value)
                elif condition.operator == NumericOperator.NEQ:
                    _conditions.append(column != condition.value)
                elif condition.operator == NumericOperator.GT:
                    _conditions.append(column > condition.value)
                elif condition.operator == NumericOperator.LT:
                    _conditions.append(column < condition.value)
                elif condition.operator == NumericOperator.GTE:
                    _conditions.append(column >= condition.value)
                elif condition.operator == NumericOperator.LTE:
                    _conditions.append(column <= condition.value)
                elif condition.operator == NumericOperator.BETWEEN:
                    _conditions.append(
                        column.between(condition.value[0], condition.value[1])
                    )

            # STRING OPERATORS
            elif isinstance(condition.operator, StringOperator):
                if condition.operator == StringOperator.STARTSWITH:
                    _conditions.append(column.startswith(condition.value))
                elif condition.operator == StringOperator.ENDSWITH:
                    _conditions.append(column.endswith(condition.value))
                elif condition.operator == StringOperator.CONTAINS:
                    _conditions.append(column.contains(condition.value))
                elif condition.operator == StringOperator.LIKE:
                    _conditions.append(column.like(condition.value))
                elif condition.operator == StringOperator.MATCHES:
                    if condition.options:
                        case_sensitive = condition.options.case_sensitive
                        exact_match = condition.options.exact_match
                    else:
                        case_sensitive = False
                        exact_match = False

                    if exact_match:
                        if case_sensitive:
                            _conditions.append(column.like(condition.value))
                        else:
                            _conditions.append(column.ilike(condition.value))
                    else:
                        pattern = f"%{condition.value}%"
                        if case_sensitive:
                            _conditions.append(column.like(pattern))
                        else:
                            _conditions.append(column.ilike(pattern))

            # LIST OPERATORS
            elif isinstance(condition.operator, ListOperator):
                if condition.operator == ListOperator.IN:
                    _conditions.append(column.in_(condition.value))

            # EXISTENCE OPERATORS
            elif isinstance(condition.operator, ExistenceOperator):
                if condition.operator == ExistenceOperator.EXISTS:
                    _conditions.append(column.isnot(None))
                elif condition.operator == ExistenceOperator.NOT_EXISTS:
                    _conditions.append(column.is_(None))

    return _conditions
