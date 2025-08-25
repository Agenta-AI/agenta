from typing import Optional, List
from uuid import UUID, uuid4
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
import sqlalchemy

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress_exceptions

from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.shared.dtos import Windowing
from oss.src.core.evaluations.interfaces import EvaluationsDAOInterface
from oss.src.core.evaluations.types import EvaluationClosedConflict
from oss.src.core.evaluations.types import (
    EvaluationRunFlags,
    EvaluationRun,
    EvaluationRunCreate,
    EvaluationRunEdit,
    EvaluationRunQuery,
    EvaluationScenario,
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationScenarioQuery,
    EvaluationStep,
    EvaluationStepCreate,
    EvaluationStepEdit,
    EvaluationStepQuery,
    EvaluationMetric,
    EvaluationMetricCreate,
    EvaluationMetricEdit,
    EvaluationMetricQuery,
    EvaluationQueue,
    EvaluationQueueCreate,
    EvaluationQueueEdit,
    EvaluationQueueQuery,
)

from oss.src.dbs.postgres.shared.exceptions import check_entity_creation_conflict
from oss.src.dbs.postgres.shared.engine import engine
from oss.src.dbs.postgres.evaluations.mappings import (
    create_dbe_from_dto,
    edit_dbe_from_dto,
    create_dto_from_dbe,
)
from oss.src.dbs.postgres.evaluations.dbes import (
    EvaluationRunDBE,
    EvaluationScenarioDBE,
    EvaluationStepDBE,
    EvaluationMetricDBE,
    EvaluationQueueDBE,
)


log = get_module_logger(__name__)


class EvaluationsDAO(EvaluationsDAOInterface):
    def __init__(self):
        pass

    # - EVALUATION RUN ---------------------------------------------------------

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def create_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run: EvaluationRunCreate,
    ) -> Optional[EvaluationRun]:
        now = datetime.now(timezone.utc)
        run = EvaluationRun(
            **run.model_dump(),
            created_at=now,
            created_by_id=user_id,
        )

        run_dbe = create_dbe_from_dto(
            DBE=EvaluationRunDBE,
            project_id=project_id,
            dto=run,
        )

        try:
            async with engine.core_session() as session:
                session.add(run_dbe)

                await session.commit()

                run = create_dto_from_dbe(
                    DTO=EvaluationRun,
                    dbe=run_dbe,
                )

                return run

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions(default=[], exclude=[EntityCreationConflict])
    async def create_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        runs: List[EvaluationRunCreate],
    ) -> List[EvaluationRun]:
        now = datetime.now(timezone.utc)
        runs = [
            EvaluationRun(
                **run.model_dump(),
                created_at=now,
                created_by_id=user_id,
            )
            for run in runs
        ]

        run_dbes = [
            create_dbe_from_dto(
                DBE=EvaluationRunDBE,
                project_id=project_id,
                dto=run,
            )
            for run in runs
        ]

        try:
            async with engine.core_session() as session:
                session.add_all(run_dbes)

                await session.commit()

                runs = [
                    create_dto_from_dbe(
                        DTO=EvaluationRun,
                        dbe=run_dbe,
                    )
                    for run_dbe in run_dbes
                ]

                return runs

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions()
    async def fetch_run(
        self,
        *,
        project_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
                EvaluationRunDBE.id == run_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            run_dbe = result.scalars().first()

            if run_dbe is None:
                return None

            run = create_dto_from_dbe(
                DTO=EvaluationRun,
                dbe=run_dbe,
            )

            return run

    @suppress_exceptions(default=[])
    async def fetch_runs(
        self,
        *,
        project_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[EvaluationRun]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
                EvaluationRunDBE.id.in_(run_ids),
            )

            stmt = stmt.limit(len(run_ids))

            result = await session.execute(stmt)

            run_dbes = result.scalars().all()

            runs = [
                create_dto_from_dbe(
                    DTO=EvaluationRun,
                    dbe=run_dbe,
                )
                for run_dbe in run_dbes
            ]

            return runs

    @suppress_exceptions()
    async def edit_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run: EvaluationRunEdit,
    ) -> Optional[EvaluationRun]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
                EvaluationRunDBE.id == run.id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            run_dbe = result.scalars().first()

            if run_dbe is None:
                return None

            run_flags = run_dbe.flags or {}

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=run.id,
                )

            run_dbe = edit_dbe_from_dto(
                dbe=run_dbe,
                dto=run,
                updated_at=datetime.now(timezone.utc),
                updated_by_id=user_id,
            )

            await session.commit()

            run = create_dto_from_dbe(
                DTO=EvaluationRun,
                dbe=run_dbe,
            )

            return run

    @suppress_exceptions(default=[])
    async def edit_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        runs: List[EvaluationRunEdit],
    ) -> List[EvaluationRun]:
        run_ids = [run.id for run in runs]

        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
                EvaluationRunDBE.id.in_(run_ids),
            )

            stmt = stmt.limit(len(run_ids))

            result = await session.execute(stmt)

            run_dbes = result.scalars().all()

            if not run_dbes:
                return []

            for run_dbe in run_dbes:
                run_flags = run_dbe.flags or {}

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=run_dbe.id,
                    )

                run = next(
                    (r for r in runs if r.id == run_dbe.id),
                    None,
                )

                if run is not None:
                    run_dbe = edit_dbe_from_dto(
                        dbe=run_dbe,
                        dto=run,
                        updated_at=datetime.now(timezone.utc),
                        updated_by_id=user_id,
                    )

            await session.commit()

            runs = [
                create_dto_from_dbe(
                    DTO=EvaluationRun,
                    dbe=run_dbe,
                )
                for run_dbe in run_dbes
            ]

            return runs

    @suppress_exceptions()
    async def delete_run(
        self,
        *,
        project_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[UUID]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
                EvaluationRunDBE.id == run_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            run_dbe = result.scalars().first()

            if run_dbe is None:
                return None

            await session.delete(run_dbe)

            await session.commit()

            return run_id

    @suppress_exceptions(default=[])
    async def delete_runs(
        self,
        *,
        project_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[UUID]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
                EvaluationRunDBE.id.in_(run_ids),
            )

            stmt = stmt.limit(len(run_ids))

            result = await session.execute(stmt)

            run_dbes = result.scalars().all()

            if not run_dbes:
                return []

            for run_dbe in run_dbes:
                await session.delete(run_dbe)

            await session.commit()

            run_ids = [run_dbe.id for run_dbe in run_dbes]

            return run_ids

    @suppress_exceptions()
    async def archive_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
                EvaluationRunDBE.id == run_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            run_dbe = result.scalars().first()

            if run_dbe is None:
                return None

            if not run_dbe.flags:
                run_dbe.flags = EvaluationRunFlags().model_dump(mode="json")

            run_dbe.flags["is_closed"] = True

            now = datetime.now(timezone.utc)
            run_dbe.updated_at = now
            run_dbe.updated_by_id = user_id
            run_dbe.deleted_at = now
            run_dbe.deleted_by_id = user_id

            await session.commit()

            run = create_dto_from_dbe(
                DTO=EvaluationRun,
                dbe=run_dbe,
            )

            return run

    @suppress_exceptions(default=[])
    async def archive_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[EvaluationRun]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
                EvaluationRunDBE.id.in_(run_ids),
            )

            stmt = stmt.limit(len(run_ids))

            result = await session.execute(stmt)

            run_dbes = result.scalars().all()

            if not run_dbes:
                return []

            for run_dbe in run_dbes:
                if not run_dbe.flags:
                    run_dbe.flags = EvaluationRunFlags().model_dump(mode="json")

                run_dbe.flags["is_closed"] = True

            now = datetime.now(timezone.utc)
            for run_dbe in run_dbes:
                run_dbe.updated_at = now
                run_dbe.updated_by_id = user_id
                run_dbe.deleted_at = now
                run_dbe.deleted_by_id = user_id

            await session.commit()

            runs = [
                create_dto_from_dbe(
                    DTO=EvaluationRun,
                    dbe=run_dbe,
                )
                for run_dbe in run_dbes
            ]

            return runs

    @suppress_exceptions()
    async def unarchive_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
                EvaluationRunDBE.id == run_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            run_dbe = result.scalars().first()

            if run_dbe is None:
                return None

            now = datetime.now(timezone.utc)
            run_dbe.updated_at = now
            run_dbe.updated_by_id = user_id
            run_dbe.deleted_at = None
            run_dbe.deleted_by_id = None

            await session.commit()

            run = create_dto_from_dbe(
                DTO=EvaluationRun,
                dbe=run_dbe,
            )

            return run

    @suppress_exceptions(default=[])
    async def unarchive_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[EvaluationRun]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
                EvaluationRunDBE.id.in_(run_ids),
            )

            stmt = stmt.limit(len(run_ids))

            result = await session.execute(stmt)

            run_dbes = result.scalars().all()

            if not run_dbes:
                return []

            now = datetime.now(timezone.utc)
            for run_dbe in run_dbes:
                run_dbe.updated_at = now
                run_dbe.updated_by_id = user_id
                run_dbe.deleted_at = None
                run_dbe.deleted_by_id = None

            await session.commit()

            runs = [
                create_dto_from_dbe(
                    DTO=EvaluationRun,
                    dbe=run_dbe,
                )
                for run_dbe in run_dbes
            ]

            return runs

    @suppress_exceptions()
    async def close_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
    ) -> Optional[EvaluationRun]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
                EvaluationRunDBE.id == run_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            run_dbe = result.scalars().first()

            if run_dbe is None:
                return None

            if not run_dbe.flags:
                run_dbe.flags = EvaluationRunFlags().model_dump(mode="json")

            run_dbe.flags["is_closed"] = True

            now = datetime.now(timezone.utc)
            run_dbe.updated_at = now
            run_dbe.updated_by_id = user_id

            await session.commit()

            run = create_dto_from_dbe(
                DTO=EvaluationRun,
                dbe=run_dbe,
            )

            return run

    @suppress_exceptions(default=[])
    async def close_runs(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_ids: List[UUID],
    ) -> List[UUID]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
                EvaluationRunDBE.id.in_(run_ids),
            )

            stmt = stmt.limit(len(run_ids))

            result = await session.execute(stmt)

            run_dbes = result.scalars().all()

            if not run_dbes:
                return []

            now = datetime.now(timezone.utc)
            for run_dbe in run_dbes:
                if not run_dbe.flags:
                    run_dbe.flags = EvaluationRunFlags().model_dump(mode="json")

                run_dbe.flags["is_closed"] = True

                run_dbe.updated_at = now
                run_dbe.updated_by_id = user_id

            await session.commit()

            runs = [
                create_dto_from_dbe(
                    DTO=EvaluationRun,
                    dbe=run_dbe,
                )
                for run_dbe in run_dbes
            ]

            return runs

    @suppress_exceptions(default=[])
    async def query_runs(
        self,
        *,
        project_id: UUID,
        #
        run: EvaluationRunQuery,
        #
        include_archived: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationRun]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
            )

            # data-based filtering: generic JSONB containment for any nested data filters
            if run.data is not None:
                data_dict = run.data.dict(exclude_none=True)
                if data_dict:
                    stmt = stmt.filter(EvaluationRunDBE.data.contains(data_dict))

            if run.flags is not None:
                stmt = stmt.filter(
                    EvaluationRunDBE.flags.contains(
                        run.flags.model_dump(mode="json"),
                    ),
                )

            if run.tags is not None:
                stmt = stmt.filter(
                    EvaluationRunDBE.tags.contains(run.tags),
                )

            if run.meta is not None:
                # If meta is a list, OR across .contains() for each dict
                if isinstance(run.meta, list):
                    or_filters = [
                        EvaluationRunDBE.meta.contains(m)
                        for m in run.meta
                        if isinstance(m, dict) and m
                    ]
                    if or_filters:
                        stmt = stmt.filter(sqlalchemy.or_(*or_filters))
                # If meta is a dict, filter as before
                elif isinstance(run.meta, dict):
                    stmt = stmt.filter(EvaluationRunDBE.meta.contains(run.meta))
                # Otherwise, ignore (invalid type)

            if run.status is not None:
                stmt = stmt.filter(
                    EvaluationRunDBE.status == run.status,
                )

            if run.ids is not None:
                stmt = stmt.filter(
                    EvaluationRunDBE.id.in_(run.ids),
                )

            if run.search is not None:
                stmt = stmt.filter(EvaluationRunDBE.name.ilike(f"%{run.search}%"))

            if include_archived is not True:
                stmt = stmt.filter(
                    EvaluationRunDBE.deleted_at.is_(None),
                )

            if windowing is not None:
                if windowing.next is not None:
                    stmt = stmt.filter(
                        EvaluationRunDBE.id > windowing.next,
                    )

                if windowing.start is not None:
                    stmt = stmt.filter(
                        EvaluationRunDBE.created_at > windowing.start,
                    )

                if windowing.stop is not None:
                    stmt = stmt.filter(
                        EvaluationRunDBE.created_at <= windowing.stop,
                    )

            if windowing is not None:
                if windowing.order:
                    if windowing.order.lower() == "ascending":
                        stmt = stmt.order_by(EvaluationRunDBE.created_at.asc())
                    elif windowing.order.lower() == "descending":
                        stmt = stmt.order_by(EvaluationRunDBE.created_at.desc())
                    else:
                        stmt = stmt.order_by(EvaluationRunDBE.created_at.desc())
                else:
                    stmt = stmt.order_by(EvaluationRunDBE.created_at.desc())
            else:
                stmt = stmt.order_by(EvaluationRunDBE.created_at.desc())

            if windowing is not None:
                if windowing.limit is not None:
                    stmt = stmt.limit(windowing.limit)

            result = await session.execute(stmt)

            run_dbes = result.scalars().all()

            runs = [
                create_dto_from_dbe(
                    DTO=EvaluationRun,
                    dbe=run_dbe,
                )
                for run_dbe in run_dbes
            ]

            return runs

    # - EVALUATION SCENARIO ----------------------------------------------------

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def create_scenario(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        scenario: EvaluationScenarioCreate,
    ) -> Optional[EvaluationScenario]:
        run_flags = await _get_run_flags(
            project_id=project_id,
            run_id=scenario.run_id,
        )

        if run_flags.get("is_closed", False):
            raise EvaluationClosedConflict(
                run_id=scenario.run_id,
            )

        now = datetime.now(timezone.utc)
        scenario = EvaluationScenario(
            **scenario.model_dump(),
            created_at=now,
            created_by_id=user_id,
        )

        scenario_dbe = create_dbe_from_dto(
            DBE=EvaluationScenarioDBE,
            project_id=project_id,
            dto=scenario,
        )

        try:
            async with engine.core_session() as session:
                session.add(scenario_dbe)

                await session.commit()

                scenario = create_dto_from_dbe(
                    DTO=EvaluationScenario,
                    dbe=scenario_dbe,
                )

                return scenario

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions(default=[], exclude=[EntityCreationConflict])
    async def create_scenarios(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        scenarios: List[EvaluationScenarioCreate],
    ) -> List[EvaluationScenario]:
        for scenario in scenarios:
            run_flags = await _get_run_flags(
                project_id=project_id,
                run_id=scenario.run_id,
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=scenario.run_id,
                )

        now = datetime.now(timezone.utc)
        scenarios = [
            EvaluationScenario(
                **scenario.model_dump(),
                created_at=now,
                created_by_id=user_id,
            )
            for scenario in scenarios
        ]

        scenario_dbes = [
            create_dbe_from_dto(
                DBE=EvaluationScenarioDBE,
                project_id=project_id,
                dto=scenario,
            )
            for scenario in scenarios
        ]

        try:
            async with engine.core_session() as session:
                session.add_all(scenario_dbes)

                await session.commit()

                scenarios = [
                    create_dto_from_dbe(
                        DTO=EvaluationScenario,
                        dbe=scenario_dbe,
                    )
                    for scenario_dbe in scenario_dbes
                ]

                return scenarios

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions()
    async def fetch_scenario(
        self,
        *,
        project_id: UUID,
        #
        scenario_id: UUID,
    ) -> Optional[EvaluationScenario]:
        async with engine.core_session() as session:
            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.project_id == project_id,
                EvaluationScenarioDBE.id == scenario_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            scenario_dbe = result.scalars().first()

            if scenario_dbe is None:
                return None

            scenario = create_dto_from_dbe(
                DTO=EvaluationScenario,
                dbe=scenario_dbe,
            )

            return scenario

    @suppress_exceptions(default=[])
    async def fetch_scenarios(
        self,
        *,
        project_id: UUID,
        #
        scenario_ids: List[UUID],
    ) -> List[EvaluationScenario]:
        async with engine.core_session() as session:
            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.project_id == project_id,
                EvaluationScenarioDBE.id.in_(scenario_ids),
            )

            stmt = stmt.limit(len(scenario_ids))

            result = await session.execute(stmt)

            scenario_dbes = result.scalars().all()

            scenarios = [
                create_dto_from_dbe(
                    DTO=EvaluationScenario,
                    dbe=scenario_dbe,
                )
                for scenario_dbe in scenario_dbes
            ]

            return scenarios

    @suppress_exceptions()
    async def edit_scenario(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        scenario: EvaluationScenarioEdit,
    ) -> Optional[EvaluationScenario]:
        async with engine.core_session() as session:
            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.project_id == project_id,
                EvaluationScenarioDBE.id == scenario.id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            scenario_dbe = result.scalars().first()

            if scenario_dbe is None:
                return None

            run_flags = await _get_run_flags(
                session=session,
                project_id=project_id,
                run_id=scenario_dbe.run_id,
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=scenario_dbe.run_id,
                    scenario_id=scenario_dbe.id,
                )

            scenario_dbe = edit_dbe_from_dto(
                dbe=scenario_dbe,
                dto=scenario,
                updated_at=datetime.now(timezone.utc),
                updated_by_id=user_id,
            )

            await session.commit()

            scenario = create_dto_from_dbe(
                DTO=EvaluationScenario,
                dbe=scenario_dbe,
            )

            return scenario

    @suppress_exceptions(default=[])
    async def edit_scenarios(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        scenarios: List[EvaluationScenarioEdit],
    ) -> List[EvaluationScenario]:
        scenario_ids = [scenario.id for scenario in scenarios]

        async with engine.core_session() as session:
            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.project_id == project_id,
                EvaluationScenarioDBE.id.in_(scenario_ids),
            )

            stmt = stmt.limit(len(scenario_ids))

            result = await session.execute(stmt)

            scenario_dbes = result.scalars().all()

            if not scenario_dbes:
                return []

            for scenario_dbe in scenario_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=scenario_dbe.run_id,
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=scenario_dbe.run_id,
                        scenario_id=scenario_dbe.id,
                    )

                scenario = next(
                    (s for s in scenarios if s.id == scenario_dbe.id),
                    None,
                )

                if scenario is not None:
                    scenario_dbe = edit_dbe_from_dto(
                        dbe=scenario_dbe,
                        dto=scenario,
                        updated_at=datetime.now(timezone.utc),
                        updated_by_id=user_id,
                    )

            await session.commit()

            scenarios = [
                create_dto_from_dbe(
                    DTO=EvaluationScenario,
                    dbe=scenario_dbe,
                )
                for scenario_dbe in scenario_dbes
            ]

            return scenarios

    @suppress_exceptions()
    async def delete_scenario(
        self,
        *,
        project_id: UUID,
        #
        scenario_id: UUID,
    ) -> Optional[UUID]:
        async with engine.core_session() as session:
            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.project_id == project_id,
                EvaluationScenarioDBE.id == scenario_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            scenario_dbe = result.scalars().first()

            if scenario_dbe is None:
                return None

            run_flags = await _get_run_flags(
                session=session,
                project_id=project_id,
                run_id=scenario_dbe.run_id,
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=scenario_dbe.run_id,
                    scenario_id=scenario_dbe.id,
                )

            await session.delete(scenario_dbe)

            await session.commit()

            return scenario_id

    @suppress_exceptions(default=[])
    async def delete_scenarios(
        self,
        *,
        project_id: UUID,
        #
        scenario_ids: List[UUID],
    ) -> List[UUID]:
        async with engine.core_session() as session:
            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.project_id == project_id,
                EvaluationScenarioDBE.id.in_(scenario_ids),
            )

            stmt = stmt.limit(len(scenario_ids))

            result = await session.execute(stmt)

            scenario_dbes = result.scalars().all()

            if not scenario_dbes:
                return []

            for scenario_dbe in scenario_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=scenario_dbe.run_id,
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=scenario_dbe.run_id,
                        scenario_id=scenario_dbe.id,
                    )

                await session.delete(scenario_dbe)

            await session.commit()

            scenario_ids = [scenario_dbe.id for scenario_dbe in scenario_dbes]

            return scenario_ids

    @suppress_exceptions(default=[])
    async def query_scenarios(
        self,
        *,
        project_id: UUID,
        #
        scenario: EvaluationScenarioQuery,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationScenario]:
        async with engine.core_session() as session:
            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.project_id == project_id,
            )

            if scenario.run_id is not None:
                stmt = stmt.filter(
                    EvaluationScenarioDBE.run_id == scenario.run_id,
                )

            if scenario.run_ids is not None:
                stmt = stmt.filter(
                    EvaluationScenarioDBE.run_id.in_(scenario.run_ids),
                )

            # if scenario.flags is not None:
            #     stmt = stmt.filter(
            #         EvaluationScenarioDBE.flags.contains(
            #             scenario.flags.model_dump(mode="json"),
            #         ),
            #     )

            if scenario.tags is not None:
                stmt = stmt.filter(
                    EvaluationScenarioDBE.tags.contains(scenario.tags),
                )

            if scenario.meta is not None:
                stmt = stmt.filter(
                    EvaluationScenarioDBE.meta.contains(scenario.meta),
                )

            if scenario.status is not None:
                stmt = stmt.filter(
                    EvaluationScenarioDBE.status == scenario.status,
                )

            if scenario.statuses is not None:
                stmt = stmt.filter(
                    EvaluationScenarioDBE.status.in_(scenario.statuses),
                )

            if windowing is not None:
                if windowing.next is not None:
                    stmt = stmt.filter(
                        EvaluationScenarioDBE.id > windowing.next,
                    )

                if windowing.start is not None:
                    stmt = stmt.filter(
                        EvaluationScenarioDBE.created_at > windowing.start,
                    )

                if windowing.stop is not None:
                    stmt = stmt.filter(
                        EvaluationScenarioDBE.created_at <= windowing.stop,
                    )

            if windowing is not None:
                if windowing.order:
                    if windowing.order.lower() == "ascending":
                        stmt = stmt.order_by(EvaluationScenarioDBE.created_at.asc())
                    elif windowing.order.lower() == "descending":
                        stmt = stmt.order_by(EvaluationScenarioDBE.created_at.desc())
                    else:
                        stmt = stmt.order_by(EvaluationScenarioDBE.created_at.desc())
                else:
                    stmt = stmt.order_by(EvaluationScenarioDBE.created_at.desc())
            else:
                stmt = stmt.order_by(EvaluationScenarioDBE.created_at.desc())

            if windowing is not None:
                if windowing.limit is not None:
                    stmt = stmt.limit(windowing.limit)

            result = await session.execute(stmt)

            scenario_dbes = result.scalars().all()

            scenarios = [
                create_dto_from_dbe(
                    DTO=EvaluationScenario,
                    dbe=scenario_dbe,
                )
                for scenario_dbe in scenario_dbes
            ]

            return scenarios

    # - EVALUATION STEP --------------------------------------------------------

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def create_step(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        step: EvaluationStepCreate,
    ) -> Optional[EvaluationStep]:
        run_flags = await _get_run_flags(
            project_id=project_id,
            run_id=step.run_id,
        )

        if run_flags.get("is_closed", False):
            raise EvaluationClosedConflict(
                run_id=step.run_id,
            )

        now = datetime.now(timezone.utc)
        step = EvaluationStep(
            **step.model_dump(exclude={"repeat_idx", "repeat_id", "retry_id"}),
            repeat_id=(
                UUID(f"{step.scenario_id.hex[:-4]}{(step.repeat_idx or 0):04x}")
                if step.repeat_id is None
                else step.repeat_id
            ),
            retry_id=step.retry_id or uuid4(),
            created_at=now,
            created_by_id=user_id,
            timestamp=now,
        )

        step_dbe = create_dbe_from_dto(
            DBE=EvaluationStepDBE,
            project_id=project_id,
            dto=step,
        )

        try:
            async with engine.core_session() as session:
                session.add(step_dbe)

                await session.commit()

                step = create_dto_from_dbe(
                    DTO=EvaluationStep,
                    dbe=step_dbe,
                )

                return step

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions(default=[], exclude=[EntityCreationConflict])
    async def create_steps(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        steps: List[EvaluationStepCreate],
    ) -> List[EvaluationStep]:
        for step in steps:
            run_flags = await _get_run_flags(
                project_id=project_id,
                run_id=step.run_id,
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=step.run_id,
                )

        async with engine.core_session() as session:
            now = datetime.now(timezone.utc)
            steps = [
                EvaluationStep(
                    **step.model_dump(exclude={"repeat_idx", "repeat_id", "retry_id"}),
                    repeat_id=(
                        UUID(f"{step.scenario_id.hex[:-4]}{(step.repeat_idx or 0):04x}")
                        if step.repeat_id is None
                        else step.repeat_id
                    ),
                    retry_id=step.retry_id or uuid4(),
                    created_at=now,
                    created_by_id=user_id,
                    timestamp=now,
                )
                for step in steps
            ]

            step_dbes = [
                create_dbe_from_dto(
                    DBE=EvaluationStepDBE,
                    project_id=project_id,
                    dto=step,
                )
                for step in steps
            ]

            session.add_all(step_dbes)

            await session.commit()

            steps = [
                create_dto_from_dbe(
                    DTO=EvaluationStep,
                    dbe=step_dbe,
                )
                for step_dbe in step_dbes
            ]

            return steps

    @suppress_exceptions()
    async def fetch_step(
        self,
        *,
        project_id: UUID,
        #
        step_id: UUID,
    ) -> Optional[EvaluationStep]:
        async with engine.core_session() as session:
            stmt = select(EvaluationStepDBE).filter(
                EvaluationStepDBE.project_id == project_id,
                EvaluationStepDBE.id == step_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            step_dbe = result.scalars().first()

            if step_dbe is None:
                return None

            step = create_dto_from_dbe(
                DTO=EvaluationStep,
                dbe=step_dbe,
            )

            return step

    @suppress_exceptions(default=[])
    async def fetch_steps(
        self,
        *,
        project_id: UUID,
        #
        step_ids: List[UUID],
    ) -> List[EvaluationStep]:
        async with engine.core_session() as session:
            stmt = select(EvaluationStepDBE).filter(
                EvaluationStepDBE.project_id == project_id,
                EvaluationStepDBE.id.in_(step_ids),
            )

            stmt = stmt.limit(len(step_ids))

            result = await session.execute(stmt)

            step_dbes = result.scalars().all()

            steps = [
                create_dto_from_dbe(
                    DTO=EvaluationStep,
                    dbe=step_dbe,
                )
                for step_dbe in step_dbes
            ]

            return steps

    @suppress_exceptions()
    async def edit_step(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        step: EvaluationStepEdit,
    ) -> Optional[EvaluationStep]:
        async with engine.core_session() as session:
            stmt = select(EvaluationStepDBE).filter(
                EvaluationStepDBE.project_id == project_id,
                EvaluationStepDBE.id == step.id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            step_dbe = result.scalars().first()

            if step_dbe is None:
                return None

            run_flags = await _get_run_flags(
                session=session,
                project_id=project_id,
                run_id=step_dbe.run_id,
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=step_dbe.run_id,
                    scenario_id=step_dbe.scenario_id,
                    step_id=step_dbe.id,
                )

            step_dbe = edit_dbe_from_dto(
                dbe=step_dbe,
                dto=step,
                timestamp=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
                updated_by_id=user_id,
            )

            await session.commit()

            step = create_dto_from_dbe(
                DTO=EvaluationStep,
                dbe=step_dbe,
            )

            return step

    @suppress_exceptions(default=[])
    async def edit_steps(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        steps: List[EvaluationStepEdit],
    ) -> List[EvaluationStep]:
        step_ids = [step.id for step in steps]

        async with engine.core_session() as session:
            stmt = select(EvaluationStepDBE).filter(
                EvaluationStepDBE.project_id == project_id,
                EvaluationStepDBE.id.in_(step_ids),
            )

            stmt = stmt.limit(len(step_ids))

            result = await session.execute(stmt)

            step_dbes = result.scalars().all()

            if not step_dbes:
                return []

            for step_dbe in step_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=step_dbe.run_id,
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=step_dbe.run_id,
                        scenario_id=step_dbe.scenario_id,
                        step_id=step_dbe.id,
                    )

                step = next(
                    (s for s in steps if s.id == step_dbe.id),
                    None,
                )

                if step is not None:
                    step_dbe = edit_dbe_from_dto(
                        dbe=step_dbe,
                        dto=step,
                        timestamp=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc),
                        updated_by_id=user_id,
                    )

            await session.commit()

            steps = [
                create_dto_from_dbe(
                    DTO=EvaluationStep,
                    dbe=step_dbe,
                )
                for step_dbe in step_dbes
            ]

            return steps

    @suppress_exceptions()
    async def delete_step(
        self,
        *,
        project_id: UUID,
        #
        step_id: UUID,
    ) -> Optional[UUID]:
        async with engine.core_session() as session:
            stmt = select(EvaluationStepDBE).filter(
                EvaluationStepDBE.project_id == project_id,
                EvaluationStepDBE.id == step_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            step_dbe = result.scalars().first()

            if step_dbe is None:
                return None

            run_flags = await _get_run_flags(
                session=session,
                project_id=project_id,
                run_id=step_dbe.run_id,
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=step_dbe.run_id,
                    scenario_id=step_dbe.scenario_id,
                    step_id=step_dbe.id,
                )

            await session.delete(step_dbe)

            await session.commit()

            return step_id

    @suppress_exceptions(default=[])
    async def delete_steps(
        self,
        *,
        project_id: UUID,
        #
        step_ids: List[UUID],
    ) -> List[UUID]:
        async with engine.core_session() as session:
            stmt = select(EvaluationStepDBE).filter(
                EvaluationStepDBE.project_id == project_id,
                EvaluationStepDBE.id.in_(step_ids),
            )

            stmt = stmt.limit(len(step_ids))

            result = await session.execute(stmt)

            step_dbes = result.scalars().all()

            if not step_dbes:
                return []

            for step_dbe in step_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=step_dbe.run_id,
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=step_dbe.run_id,
                        scenario_id=step_dbe.scenario_id,
                        step_id=step_dbe.id,
                    )

                await session.delete(step_dbe)

            await session.commit()

            return step_ids

    @suppress_exceptions(default=[])
    async def query_steps(
        self,
        *,
        project_id: UUID,
        #
        step: EvaluationStepQuery,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationStep]:
        async with engine.core_session() as session:
            stmt = select(EvaluationStepDBE).filter(
                EvaluationStepDBE.project_id == project_id,
            )

            if step.ids is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.id.in_(step.ids),
                )

            if step.run_id is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.run_id == step.run_id,
                )

            if step.run_ids is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.run_id.in_(step.run_ids),
                )

            if step.scenario_id is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.scenario_id == step.scenario_id,
                )

            if step.scenario_ids is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.scenario_id.in_(step.scenario_ids),
                )

            # if step.flags is not None:
            #     stmt = stmt.filter(
            #         EvaluationStepDBE.flags.contains(
            #             step.flags.model_dump(mode="json"),
            #         ),
            #     )

            if step.tags is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.tags.contains(step.tags),
                )

            if step.meta is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.meta.contains(step.meta),
                )

            if step.key is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.key == step.key,
                )

            if step.keys is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.key.in_(step.keys),
                )

            if step.repeat_id is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.repeat_id == step.repeat_id,
                )

            if step.repeat_ids is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.repeat_id.in_(step.repeat_ids),
                )

            if step.repeat_idx is not None and step.scenario_id is not None:
                repeat_id = UUID(f"{step.scenario_id.hex[:-4]}{step.repeat_idx:04x}")

                stmt = stmt.filter(
                    EvaluationStepDBE.repeat_id == repeat_id,
                )

            if step.repeat_idxs is not None and step.scenario_id is not None:
                repeat_ids = [
                    UUID(f"{step.scenario_id.hex[:-4]}{idx:04x}")
                    for idx in step.repeat_idxs
                ]

                stmt = stmt.filter(
                    EvaluationStepDBE.repeat_id.in_(repeat_ids),
                )

            if step.repeat_idx is not None and step.scenario_ids is not None:
                repeat_ids = [
                    UUID(f"{scenario_id.hex[:-4]}{step.repeat_idx:04x}")
                    for scenario_id in step.scenario_ids
                ]

                stmt = stmt.filter(
                    EvaluationStepDBE.repeat_id.in_(repeat_ids),
                )

            if step.repeat_idxs is not None and step.scenario_ids is not None:
                repeat_ids = [
                    UUID(f"{scenario_id.hex[:-4]}{idx:04x}")
                    for scenario_id in step.scenario_ids
                    for idx in step.repeat_idxs
                ]

                stmt = stmt.filter(
                    EvaluationStepDBE.repeat_id.in_(repeat_ids),
                )

            if step.retry_id is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.retry_id == step.retry_id,
                )

            if step.retry_ids is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.retry_id.in_(step.retry_ids),
                )

            if step.status is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.status == step.status,
                )

            if step.statuses is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.status.in_(step.statuses),
                )

            if step.timestamp is not None:
                stmt = stmt.filter(
                    EvaluationStepDBE.timestamp > step.timestamp,
                )

            if windowing is not None:
                if windowing.next is not None:
                    stmt = stmt.filter(
                        EvaluationStepDBE.id > windowing.next,
                    )

                if windowing.start is not None:
                    stmt = stmt.filter(
                        EvaluationStepDBE.created_at > windowing.start,
                    )

                if windowing.stop is not None:
                    stmt = stmt.filter(
                        EvaluationStepDBE.created_at <= windowing.stop,
                    )

            if windowing is not None:
                if windowing.order:
                    if windowing.order.lower() == "ascending":
                        stmt = stmt.order_by(EvaluationStepDBE.created_at.asc())
                    elif windowing.order.lower() == "descending":
                        stmt = stmt.order_by(EvaluationStepDBE.created_at.desc())
                    else:
                        stmt = stmt.order_by(EvaluationStepDBE.created_at.desc())
                else:
                    stmt = stmt.order_by(EvaluationStepDBE.created_at.desc())
            else:
                stmt = stmt.order_by(EvaluationStepDBE.created_at.desc())

            if windowing is not None:
                if windowing.limit is not None:
                    stmt = stmt.limit(windowing.limit)

            result = await session.execute(stmt)

            step_dbes = result.scalars().all()

            steps = [
                create_dto_from_dbe(
                    DTO=EvaluationStep,
                    dbe=step_dbe,
                )
                for step_dbe in step_dbes
            ]

            return steps

    # - EVALUATION METRIC ------------------------------------------------------

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def create_metric(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metric: EvaluationMetricCreate,
    ) -> Optional[EvaluationMetric]:
        run_flags = await _get_run_flags(
            project_id=project_id,
            run_id=metric.run_id,
        )

        if run_flags.get("is_closed", False):
            raise EvaluationClosedConflict(
                run_id=metric.run_id,
            )

        now = datetime.now(timezone.utc)
        metric = EvaluationMetric(
            **metric.model_dump(),
            created_at=now,
            created_by_id=user_id,
        )

        metric_dbe = create_dbe_from_dto(
            DBE=EvaluationMetricDBE,
            project_id=project_id,
            dto=metric,
        )

        try:
            async with engine.core_session() as session:
                session.add(metric_dbe)

                await session.commit()

                metric = create_dto_from_dbe(
                    DTO=EvaluationMetric,
                    dbe=metric_dbe,
                )

                return metric

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions(default=[], exclude=[EntityCreationConflict])
    async def create_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metrics: List[EvaluationMetricCreate],
    ) -> List[EvaluationMetric]:
        for metric in metrics:
            run_flags = await _get_run_flags(
                project_id=project_id,
                run_id=metric.run_id,
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=metric.run_id,
                )

        now = datetime.now(timezone.utc)
        metrics = [
            EvaluationMetric(
                **metric.model_dump(),
                created_at=now,
                created_by_id=user_id,
            )
            for metric in metrics
        ]

        metric_dbes = [
            create_dbe_from_dto(
                DBE=EvaluationMetricDBE,
                project_id=project_id,
                dto=metric,
            )
            for metric in metrics
        ]

        try:
            async with engine.core_session() as session:
                session.add_all(metric_dbes)

                await session.commit()

                metrics = [
                    create_dto_from_dbe(
                        DTO=EvaluationMetric,
                        dbe=metric_dbe,
                    )
                    for metric_dbe in metric_dbes
                ]

                return metrics

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions()
    async def fetch_metric(
        self,
        *,
        project_id: UUID,
        #
        metric_id: UUID,
    ) -> Optional[EvaluationMetric]:
        async with engine.core_session() as session:
            stmt = select(EvaluationMetricDBE).filter(
                EvaluationMetricDBE.project_id == project_id,
                EvaluationMetricDBE.id == metric_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            metric_dbe = result.scalars().first()

            if metric_dbe is None:
                return None

            metric = create_dto_from_dbe(
                DTO=EvaluationMetric,
                dbe=metric_dbe,
            )

            return metric

    @suppress_exceptions(default=[])
    async def fetch_metrics(
        self,
        *,
        project_id: UUID,
        #
        metric_ids: List[UUID],
    ) -> List[EvaluationMetric]:
        async with engine.core_session() as session:
            stmt = select(EvaluationMetricDBE).filter(
                EvaluationMetricDBE.project_id == project_id,
                EvaluationMetricDBE.id.in_(metric_ids),
            )

            stmt = stmt.limit(len(metric_ids))

            result = await session.execute(stmt)

            metric_dbes = result.scalars().all()

            metrics = [
                create_dto_from_dbe(
                    DTO=EvaluationMetric,
                    dbe=metric_dbe,
                )
                for metric_dbe in metric_dbes
            ]

            return metrics

    @suppress_exceptions()
    async def edit_metric(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metric: EvaluationMetricEdit,
    ) -> Optional[EvaluationMetric]:
        async with engine.core_session() as session:
            stmt = select(EvaluationMetricDBE).filter(
                EvaluationMetricDBE.project_id == project_id,
                EvaluationMetricDBE.id == metric.id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            metric_dbe = result.scalars().first()

            if metric_dbe is None:
                return None

            run_flags = await _get_run_flags(
                session=session,
                project_id=project_id,
                run_id=metric_dbe.run_id,
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=metric_dbe.run_id,
                    scenario_id=metric_dbe.scenario_id,
                    metric_id=metric_dbe.id,
                )

            metric_dbe = edit_dbe_from_dto(
                dbe=metric_dbe,
                dto=metric,
                updated_at=datetime.now(timezone.utc),
                updated_by_id=user_id,
            )

            await session.commit()

            metric = create_dto_from_dbe(
                DTO=EvaluationMetric,
                dbe=metric_dbe,
            )

            return metric

    @suppress_exceptions(default=[])
    async def edit_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metrics: List[EvaluationMetricEdit],
    ) -> List[EvaluationMetric]:
        metric_ids = [metric.id for metric in metrics]

        async with engine.core_session() as session:
            stmt = select(EvaluationMetricDBE).filter(
                EvaluationMetricDBE.project_id == project_id,
                EvaluationMetricDBE.id.in_(metric_ids),
            )

            stmt = stmt.limit(len(metric_ids))

            result = await session.execute(stmt)

            metric_dbes = result.scalars().all()

            if not metric_dbes:
                return []

            for metric_dbe in metric_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=metric_dbe.run_id,
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=metric_dbe.run_id,
                        scenario_id=metric_dbe.scenario_id,
                        metric_id=metric_dbe.id,
                    )

                metric = next(
                    (m for m in metrics if m.id == metric_dbe.id),
                    None,
                )

                if metric is not None:
                    metric_dbe = edit_dbe_from_dto(
                        dbe=metric_dbe,
                        dto=metric,
                        updated_at=datetime.now(timezone.utc),
                        updated_by_id=user_id,
                    )

            await session.commit()

            metrics = [
                create_dto_from_dbe(
                    DTO=EvaluationMetric,
                    dbe=metric_dbe,
                )
                for metric_dbe in metric_dbes
            ]

            return metrics

    @suppress_exceptions()
    async def delete_metric(
        self,
        *,
        project_id: UUID,
        #
        metric_id: UUID,
    ) -> Optional[UUID]:
        async with engine.core_session() as session:
            stmt = select(EvaluationMetricDBE).filter(
                EvaluationMetricDBE.project_id == project_id,
                EvaluationMetricDBE.id == metric_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            metric_dbe = result.scalars().first()

            if metric_dbe is None:
                return None

            run_flags = await _get_run_flags(
                session=session,
                project_id=project_id,
                run_id=metric_dbe.run_id,
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=metric_dbe.run_id,
                    scenario_id=metric_dbe.scenario_id,
                    metric_id=metric_dbe.id,
                )

            await session.delete(metric_dbe)

            await session.commit()

            return metric_id

    @suppress_exceptions(default=[])
    async def delete_metrics(
        self,
        *,
        project_id: UUID,
        #
        metric_ids: Optional[List[UUID]] = None,
    ) -> List[UUID]:
        async with engine.core_session() as session:
            if metric_ids is None:
                return []

            stmt = select(EvaluationMetricDBE).filter(
                EvaluationMetricDBE.project_id == project_id,
                EvaluationMetricDBE.id.in_(metric_ids),
            )

            stmt = stmt.limit(len(metric_ids))

            result = await session.execute(stmt)

            metric_dbes = result.scalars().all()

            if not metric_dbes:
                return []

            for metric_dbe in metric_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=metric_dbe.run_id,
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=metric_dbe.run_id,
                        scenario_id=metric_dbe.scenario_id,
                        metric_id=metric_dbe.id,
                    )

                await session.delete(metric_dbe)

            await session.commit()

            return metric_ids

    @suppress_exceptions(default=[])
    async def query_metrics(
        self,
        *,
        project_id: UUID,
        #
        metric: EvaluationMetricQuery,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationMetric]:
        async with engine.core_session() as session:
            stmt = select(EvaluationMetricDBE).filter(
                EvaluationMetricDBE.project_id == project_id,
            )

            if metric.run_id is not None:
                stmt = stmt.filter(
                    EvaluationMetricDBE.run_id == metric.run_id,
                )

            if metric.run_ids is not None:
                stmt = stmt.filter(
                    EvaluationMetricDBE.run_id.in_(metric.run_ids),
                )

            if metric.scenario_id is not None:
                stmt = stmt.filter(
                    EvaluationMetricDBE.scenario_id == metric.scenario_id,
                )

            if metric.scenario_ids is not None:
                stmt = stmt.filter(
                    EvaluationMetricDBE.scenario_id.in_(metric.scenario_ids),
                )

            # if metric.flags is not None:
            #     stmt = stmt.filter(
            #         EvaluationMetricDBE.flags.contains(
            #             metric.flags.model_dump(mode="json"),
            #         ),
            #     )

            if metric.tags is not None:
                stmt = stmt.filter(
                    EvaluationMetricDBE.tags.contains(metric.tags),
                )

            if metric.meta is not None:
                stmt = stmt.filter(
                    EvaluationMetricDBE.meta.contains(metric.meta),
                )

            if metric.status is not None:
                stmt = stmt.filter(
                    EvaluationMetricDBE.status == metric.status,
                )

            if metric.statuses is not None:
                stmt = stmt.filter(
                    EvaluationMetricDBE.status.in_(metric.statuses),
                )

            if windowing is not None:
                if windowing.next is not None:
                    stmt = stmt.filter(
                        EvaluationMetricDBE.id > windowing.next,
                    )

                if windowing.start is not None:
                    stmt = stmt.filter(
                        EvaluationMetricDBE.created_at > windowing.start,
                    )

                if windowing.stop is not None:
                    stmt = stmt.filter(
                        EvaluationMetricDBE.created_at <= windowing.stop,
                    )

            if windowing is not None:
                if windowing.order:
                    if windowing.order.lower() == "ascending":
                        stmt = stmt.order_by(EvaluationMetricDBE.created_at.asc())
                    elif windowing.order.lower() == "descending":
                        stmt = stmt.order_by(EvaluationMetricDBE.created_at.desc())
                    else:
                        stmt = stmt.order_by(EvaluationMetricDBE.created_at.desc())
                else:
                    stmt = stmt.order_by(EvaluationMetricDBE.created_at.desc())
            else:
                stmt = stmt.order_by(EvaluationMetricDBE.created_at.desc())

            if windowing is not None:
                if windowing.limit is not None:
                    stmt = stmt.limit(windowing.limit)

            result = await session.execute(stmt)

            metric_dbes = result.scalars().all()

            metrics = [
                create_dto_from_dbe(
                    DTO=EvaluationMetric,
                    dbe=metric_dbe,
                )
                for metric_dbe in metric_dbes
            ]

            return metrics

    # - EVALUATION QUEUE -------------------------------------------------------

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def create_queue(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        queue: EvaluationQueueCreate,
    ) -> Optional[EvaluationQueue]:
        run_flags = await _get_run_flags(
            project_id=project_id,
            run_id=queue.run_id,
        )

        if run_flags.get("is_closed", False):
            raise EvaluationClosedConflict(
                run_id=queue.run_id,
            )

        now = datetime.now(timezone.utc)
        queue = EvaluationQueue(
            **queue.model_dump(),
            created_at=now,
            created_by_id=user_id,
        )

        if queue.data and queue.data.user_ids:
            queue.data.user_ids = [
                [str(repeat_user_id) for repeat_user_id in repeat_user_ids]
                for repeat_user_ids in queue.data.user_ids
            ]

        queue_dbe = create_dbe_from_dto(
            DBE=EvaluationQueueDBE,
            project_id=project_id,
            dto=queue,
        )

        try:
            async with engine.core_session() as session:
                session.add(queue_dbe)

                await session.commit()

                queue = create_dto_from_dbe(
                    DTO=EvaluationQueue,
                    dbe=queue_dbe,
                )

                return queue

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions(default=[], exclude=[EntityCreationConflict])
    async def create_queues(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        queues: List[EvaluationQueueCreate],
    ) -> List[EvaluationQueue]:
        for queue in queues:
            run_flags = await _get_run_flags(
                project_id=project_id,
                run_id=queue.run_id,
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=queue.run_id,
                )

        now = datetime.now(timezone.utc)
        queues = [
            EvaluationQueue(
                **queue.model_dump(),
                created_at=now,
                created_by_id=user_id,
            )
            for queue in queues
        ]

        for queue in queues:
            if queue.data and queue.data.user_ids:
                queue.data.user_ids = [
                    [str(repeat_user_id) for repeat_user_id in repeat_user_ids]
                    for repeat_user_ids in queue.data.user_ids
                ]

        queue_dbes = [
            create_dbe_from_dto(
                DBE=EvaluationQueueDBE,
                project_id=project_id,
                dto=queue,
            )
            for queue in queues
        ]

        try:
            async with engine.core_session() as session:
                session.add_all(queue_dbes)

                await session.commit()

                queues = [
                    create_dto_from_dbe(
                        DTO=EvaluationQueue,
                        dbe=queue_dbe,
                    )
                    for queue_dbe in queue_dbes
                ]

                return queues

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions()
    async def fetch_queue(
        self,
        *,
        project_id: UUID,
        #
        queue_id: UUID,
    ) -> Optional[EvaluationQueue]:
        async with engine.core_session() as session:
            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.project_id == project_id,
                EvaluationQueueDBE.id == queue_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            queue_dbe = result.scalars().first()

            if queue_dbe is None:
                return None

            queue = create_dto_from_dbe(
                DTO=EvaluationQueue,
                dbe=queue_dbe,
            )

            return queue

    @suppress_exceptions(default=[])
    async def fetch_queues(
        self,
        *,
        project_id: UUID,
        #
        queue_ids: List[UUID],
    ) -> List[EvaluationQueue]:
        async with engine.core_session() as session:
            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.project_id == project_id,
                EvaluationQueueDBE.id.in_(queue_ids),
            )

            stmt = stmt.limit(len(queue_ids))

            result = await session.execute(stmt)

            queue_dbes = result.scalars().all()

            queues = [
                create_dto_from_dbe(
                    DTO=EvaluationQueue,
                    dbe=queue_dbe,
                )
                for queue_dbe in queue_dbes
            ]

            return queues

    @suppress_exceptions()
    async def edit_queue(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        queue: EvaluationQueueEdit,
    ) -> Optional[EvaluationQueue]:
        async with engine.core_session() as session:
            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.project_id == project_id,
                EvaluationQueueDBE.id == queue.id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            queue_dbe = result.scalars().first()

            if queue_dbe is None:
                return None

            run_flags = await _get_run_flags(
                session=session,
                project_id=project_id,
                run_id=queue_dbe.run_id,
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=queue_dbe.run_id,
                    queue_id=queue_dbe.id,
                )

            queue_dbe = edit_dbe_from_dto(
                dbe=queue_dbe,
                dto=queue,
                updated_at=datetime.now(timezone.utc),
                updated_by_id=user_id,
            )

            await session.commit()

            queue = create_dto_from_dbe(
                DTO=EvaluationQueue,
                dbe=queue_dbe,
            )

            return queue

    @suppress_exceptions(default=[])
    async def edit_queues(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        queues: List[EvaluationQueueEdit],
    ) -> List[EvaluationQueue]:
        queue_ids = [queue.id for queue in queues]

        async with engine.core_session() as session:
            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.project_id == project_id,
                EvaluationQueueDBE.id.in_(queue_ids),
            )

            stmt = stmt.limit(len(queue_ids))

            result = await session.execute(stmt)

            queue_dbes = result.scalars().all()

            if not queue_dbes:
                return []

            for queue_dbe in queue_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=queue_dbe.run_id,
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=queue_dbe.run_id,
                        queue_id=queue_dbe.id,
                    )

                queue = next(
                    (q for q in queues if q.id == queue_dbe.id),
                    None,
                )

                if queue is not None:
                    queue_dbe = edit_dbe_from_dto(
                        dbe=queue_dbe,
                        dto=queue,
                        updated_at=datetime.now(timezone.utc),
                        updated_by_id=user_id,
                    )

            await session.commit()

            queues = [
                create_dto_from_dbe(
                    DTO=EvaluationQueue,
                    dbe=queue_dbe,
                )
                for queue_dbe in queue_dbes
            ]

            return queues

    @suppress_exceptions()
    async def delete_queue(
        self,
        *,
        project_id: UUID,
        #
        queue_id: UUID,
    ) -> Optional[UUID]:
        async with engine.core_session() as session:
            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.project_id == project_id,
                EvaluationQueueDBE.id == queue_id,
            )

            stmt = stmt.limit(1)

            result = await session.execute(stmt)

            queue_dbe = result.scalars().first()

            if queue_dbe is None:
                return None

            await session.delete(queue_dbe)

            await session.commit()

            return queue_id

    @suppress_exceptions(default=[])
    async def delete_queues(
        self,
        *,
        project_id: UUID,
        #
        queue_ids: List[UUID],
    ) -> List[UUID]:
        async with engine.core_session() as session:
            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.project_id == project_id,
                EvaluationQueueDBE.id.in_(queue_ids),
            )

            stmt = stmt.limit(len(queue_ids))

            result = await session.execute(stmt)

            queue_dbes = result.scalars().all()

            if not queue_dbes:
                return []

            for queue_dbe in queue_dbes:
                await session.delete(queue_dbe)

            await session.commit()

            return queue_ids

    @suppress_exceptions(default=[])
    async def query_queues(
        self,
        *,
        project_id: UUID,
        #
        queue: EvaluationQueueQuery,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationQueue]:
        async with engine.core_session() as session:
            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.project_id == project_id,
            )

            if queue.run_id is not None:
                stmt = stmt.filter(
                    EvaluationQueueDBE.run_id == queue.run_id,
                )

            if queue.run_ids is not None:
                stmt = stmt.filter(
                    EvaluationQueueDBE.run_id.in_(queue.run_ids),
                )

            if queue.flags is not None:
                stmt = stmt.filter(
                    EvaluationQueueDBE.flags.contains(
                        queue.flags.model_dump(mode="json"),
                    ),
                )

            if queue.tags is not None:
                stmt = stmt.filter(
                    EvaluationQueueDBE.tags.contains(queue.tags),
                )

            if queue.meta is not None:
                stmt = stmt.filter(
                    EvaluationQueueDBE.meta.contains(queue.meta),
                )

            stmt = stmt.order_by(EvaluationQueueDBE.created_at.desc())

            if windowing is not None:
                if windowing.next is not None:
                    stmt = stmt.filter(
                        EvaluationQueueDBE.id > windowing.next,
                    )

                if windowing.start is not None:
                    stmt = stmt.filter(
                        EvaluationQueueDBE.created_at > windowing.start,
                    )

                if windowing.stop is not None:
                    stmt = stmt.filter(
                        EvaluationQueueDBE.created_at <= windowing.stop,
                    )

                if windowing.limit is not None:
                    stmt = stmt.limit(windowing.limit)

            result = await session.execute(stmt)

            queue_dbes = result.scalars().all()

            queues = [
                create_dto_from_dbe(
                    DTO=EvaluationQueue,
                    dbe=queue_dbe,
                )
                for queue_dbe in queue_dbes
            ]

            return queues

    # --------------------------------------------------------------------------


async def _get_run_flags(
    *,
    project_id: UUID,
    run_id: UUID,
    session: Optional[AsyncSession] = None,
) -> dict:
    if session is None:
        async with engine.core_session() as session:
            return await _get_run_flags(
                project_id=project_id,
                run_id=run_id,
                session=session,
            )

    stmt = select(EvaluationRunDBE.flags).filter(
        EvaluationRunDBE.project_id == project_id,
        EvaluationRunDBE.id == run_id,
    )
    result = await session.execute(stmt)
    run_flags = result.scalars().first()

    return run_flags or {}
