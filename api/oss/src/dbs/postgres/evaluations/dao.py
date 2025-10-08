from typing import Optional, List, Tuple, Dict
from uuid import UUID
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import not_
import sqlalchemy
from sqlalchemy.orm.attributes import flag_modified


from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress_exceptions

from oss.src.core.shared.exceptions import EntityCreationConflict
from oss.src.core.shared.dtos import Windowing, Reference
from oss.src.core.evaluations.interfaces import EvaluationsDAOInterface
from oss.src.core.evaluations.types import EvaluationClosedConflict
from oss.src.core.evaluations.types import (
    EvaluationRunFlags,
    EvaluationRun,
    EvaluationRunCreate,
    EvaluationRunEdit,
    EvaluationRunQuery,
    #
    EvaluationScenario,
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationScenarioQuery,
    #
    EvaluationResult,
    EvaluationResultCreate,
    EvaluationResultEdit,
    EvaluationResultQuery,
    #
    EvaluationMetrics,
    EvaluationMetricsCreate,
    EvaluationMetricsEdit,
    EvaluationMetricsQuery,
    #
    EvaluationQueue,
    EvaluationQueueCreate,
    EvaluationQueueEdit,
    EvaluationQueueQuery,
)

from oss.src.dbs.postgres.shared.utils import apply_windowing
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
    EvaluationResultDBE,
    EvaluationMetricsDBE,
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
        _run = EvaluationRun(
            **run.model_dump(
                mode="json",
                exclude_none=True,
            ),
            created_at=datetime.now(timezone.utc),
            created_by_id=user_id,
        )

        run_references: List[dict] = []

        if _run and _run.data and _run.data.steps:
            _references: Dict[str, dict] = {}

            for step in _run.data.steps:
                if not step.references:
                    continue

                for key, ref in step.references.items():
                    _key = getattr(ref, "id", None) or key
                    _references[_key] = ref.model_dump(
                        mode="json",
                        exclude_none=True,
                    ) | {"key": str(key)}

            run_references = list(_references.values())

        run_dbe = create_dbe_from_dto(
            DBE=EvaluationRunDBE,
            project_id=project_id,
            dto=_run,
            #
            references=run_references,
        )

        if _run.data:
            run_dbe.data = _run.data.model_dump(mode="json")  # type: ignore

        try:
            async with engine.core_session() as session:
                session.add(run_dbe)

                await session.commit()

                _run = create_dto_from_dbe(
                    DTO=EvaluationRun,
                    dbe=run_dbe,
                )

                return _run

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
        _runs = [
            EvaluationRun(
                **run.model_dump(
                    mode="json",
                    exclude_none=True,
                ),
                created_at=datetime.now(timezone.utc),
                created_by_id=user_id,
            )
            for run in runs
        ]

        runs_references: List[List[dict]] = []

        for _run in _runs:
            run_references: List[dict] = []

            if _run and _run.data and _run.data.steps:
                _references: Dict[str, dict] = {}

                for step in _run.data.steps:
                    if not step.references:
                        continue

                    for key, ref in step.references.items():
                        _key = getattr(ref, "id", None) or key
                        _references[_key] = ref.model_dump(
                            mode="json",
                            exclude_none=True,
                        ) | {"key": str(key)}

                run_references = list(_references.values())

            runs_references.append(run_references)

        run_dbes = []

        for i, _run in enumerate(_runs):
            run_dbe = create_dbe_from_dto(
                DBE=EvaluationRunDBE,
                project_id=project_id,
                dto=_run,
                #
                references=runs_references[i],
            )

            if _run.data:
                run_dbe.data = _run.data.model_dump(mode="json")  # type: ignore

            run_dbes.append(run_dbe)

        try:
            async with engine.core_session() as session:
                session.add_all(run_dbes)

                await session.commit()

                _runs = [
                    create_dto_from_dbe(
                        DTO=EvaluationRun,
                        dbe=run_dbe,
                    )
                    for run_dbe in run_dbes
                ]

                return _runs

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
            )

            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.id == run_id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            run_dbe = res.scalars().first()

            if run_dbe is None:
                return None

            _run = create_dto_from_dbe(
                DTO=EvaluationRun,
                dbe=run_dbe,
            )

            return _run

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
            )

            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.id.in_(run_ids),
            )

            stmt = stmt.limit(len(run_ids))

            res = await session.execute(stmt)

            run_dbes = res.scalars().all()

            _runs = [
                create_dto_from_dbe(
                    DTO=EvaluationRun,
                    dbe=run_dbe,
                )
                for run_dbe in run_dbes
            ]

            return _runs

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
            )

            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.id == run.id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            run_dbe = res.scalars().first()

            if run_dbe is None:
                return None

            run_flags = run_dbe.flags or {}

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=run.id,
                )

            run_references: List[dict] = []

            if run and run.data and run.data.steps:
                _references: Dict[str, dict] = {}

                for step in run.data.steps:
                    if not step.references:
                        continue

                    for key, ref in step.references.items():
                        _key = getattr(ref, "id", None) or key
                        _references[_key] = ref.model_dump(
                            mode="json",
                            exclude_none=True,
                        ) | {"key": str(key)}

                run_references = list(_references.values())

            run_dbe = edit_dbe_from_dto(
                dbe=run_dbe,
                dto=run,
                updated_at=datetime.now(timezone.utc),
                updated_by_id=user_id,
                references=run_references,
            )

            if run.data:
                run_dbe.data = run.data.model_dump(mode="json")  # type: ignore

            await session.commit()

            _run = create_dto_from_dbe(
                DTO=EvaluationRun,
                dbe=run_dbe,
            )

            return _run

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
            )

            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.id.in_(run_ids),
            )

            stmt = stmt.limit(len(run_ids))

            res = await session.execute(stmt)

            run_dbes = res.scalars().all()

            if not run_dbes:
                return []

            for run_dbe in run_dbes:
                run_flags = run_dbe.flags or {}

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=run_dbe.id,  # type: ignore
                    )

                run = next(
                    (r for r in runs if r.id == run_dbe.id),
                    None,
                )

                if run is None:
                    continue

                run_references: List[dict] = []

                if run and run.data and run.data.steps:
                    _references: Dict[str, dict] = {}

                    for step in run.data.steps:
                        if not step.references:
                            continue

                        for key, ref in step.references.items():
                            _key = getattr(ref, "id", None) or key
                            _references[_key] = ref.model_dump(
                                mode="json",
                                exclude_none=True,
                            ) | {"key": str(key)}

                    run_references = list(_references.values())

                run_dbe = edit_dbe_from_dto(
                    dbe=run_dbe,
                    dto=run,
                    updated_at=datetime.now(timezone.utc),
                    updated_by_id=user_id,
                    references=run_references,
                )

                if run.data:
                    run_dbe.data = run.data.model_dump(mode="json")  # type: ignore

            await session.commit()

            _runs = [
                create_dto_from_dbe(
                    DTO=EvaluationRun,
                    dbe=run_dbe,
                )
                for run_dbe in run_dbes
            ]

            return _runs

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
            )

            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.id == run_id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            run_dbe = res.scalars().first()

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
            )

            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.id.in_(run_ids),
            )

            stmt = stmt.limit(len(run_ids))

            res = await session.execute(stmt)

            run_dbes = res.scalars().all()

            if not run_dbes:
                return []

            for run_dbe in run_dbes:
                await session.delete(run_dbe)

            await session.commit()

            run_ids = [run_dbe.id for run_dbe in run_dbes]  # type: ignore

            return run_ids

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
            )

            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.id == run_id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            run_dbe = res.scalars().first()

            if run_dbe is None:
                return None

            if run_dbe.flags is None:
                run_dbe.flags = EvaluationRunFlags().model_dump(  # type: ignore
                    mode="json",
                    exclude_none=True,
                )

            run_dbe.flags["is_closed"] = True  # type: ignore
            flag_modified(run_dbe, "flags")

            run_dbe.updated_at = datetime.now(timezone.utc)  # type: ignore
            run_dbe.updated_by_id = user_id  # type: ignore

            await session.commit()

            _run = create_dto_from_dbe(
                DTO=EvaluationRun,
                dbe=run_dbe,
            )

            return _run

    @suppress_exceptions(default=[])
    async def close_runs(
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
            )

            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.id.in_(run_ids),
            )

            stmt = stmt.limit(len(run_ids))

            res = await session.execute(stmt)

            run_dbes = res.scalars().all()

            if not run_dbes:
                return []

            for run_dbe in run_dbes:
                if run_dbe.flags is None:
                    run_dbe.flags = EvaluationRunFlags().model_dump(  # type: ignore
                        mode="json",
                        exclude_none=True,
                    )

                run_dbe.flags["is_closed"] = True  # type: ignore
                flag_modified(run_dbe, "flags")

                run_dbe.updated_at = datetime.now(timezone.utc)  # type: ignore
                run_dbe.updated_by_id = user_id  # type: ignore

            await session.commit()

            _runs = [
                create_dto_from_dbe(
                    DTO=EvaluationRun,
                    dbe=run_dbe,
                )
                for run_dbe in run_dbes
            ]

            return _runs

    @suppress_exceptions()
    async def open_run(
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
            )

            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.id == run_id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            run_dbe = res.scalars().first()

            if run_dbe is None:
                return None

            if run_dbe.flags is None:
                run_dbe.flags = EvaluationRunFlags().model_dump(  # type: ignore
                    mode="json",
                    exclude_none=True,
                )

            run_dbe.flags["is_closed"] = False  # type: ignore
            flag_modified(run_dbe, "flags")

            run_dbe.updated_at = datetime.now(timezone.utc)  # type: ignore
            run_dbe.updated_by_id = user_id  # type: ignore

            await session.commit()

            _run = create_dto_from_dbe(
                DTO=EvaluationRun,
                dbe=run_dbe,
            )

            return _run

    @suppress_exceptions(default=[])
    async def open_runs(
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
            )

            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.id.in_(run_ids),
            )

            stmt = stmt.limit(len(run_ids))

            res = await session.execute(stmt)

            run_dbes = res.scalars().all()

            if not run_dbes:
                return []

            for run_dbe in run_dbes:
                if run_dbe.flags is None:
                    run_dbe.flags = EvaluationRunFlags().model_dump(  # type: ignore
                        mode="json",
                        exclude_none=True,
                    )

                run_dbe.flags["is_closed"] = False  # type: ignore
                flag_modified(run_dbe, "flags")

                run_dbe.updated_at = datetime.now(timezone.utc)  # type: ignore
                run_dbe.updated_by_id = user_id  # type: ignore

            await session.commit()

            _runs = [
                create_dto_from_dbe(
                    DTO=EvaluationRun,
                    dbe=run_dbe,
                )
                for run_dbe in run_dbes
            ]

            return _runs

    @suppress_exceptions(default=[])
    async def query_runs(
        self,
        *,
        project_id: UUID,
        #
        run: Optional[EvaluationRunQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationRun]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE).filter(
                EvaluationRunDBE.project_id == project_id,
            )

            if run is not None:
                if run.ids is not None:
                    stmt = stmt.filter(
                        EvaluationRunDBE.id.in_(run.ids),
                    )

                if run.references is not None:
                    run_references: List[dict] = list()

                    for _references in run.references:
                        for key, ref in _references.items():
                            # _key = getattr(ref, "id", None) or key
                            run_references.append(
                                ref.model_dump(
                                    mode="json",
                                    exclude_none=True,
                                )
                                # | {"key": str(key)}
                            )

                    stmt = stmt.filter(
                        EvaluationRunDBE.references.contains(run_references),
                    )

                if run.flags is not None:
                    stmt = stmt.filter(
                        EvaluationRunDBE.flags.contains(run.flags),
                    )

                if run.tags is not None:
                    stmt = stmt.filter(
                        EvaluationRunDBE.tags.contains(run.tags),
                    )

                if run.meta is not None:
                    stmt = stmt.filter(
                        EvaluationRunDBE.meta.contains(run.meta),
                    )

                if run.status is not None:
                    stmt = stmt.filter(
                        EvaluationRunDBE.status == run.status,
                    )

                if run.statuses is not None:
                    stmt = stmt.filter(
                        EvaluationRunDBE.status.in_(run.statuses),
                    )

                if run.name is not None:
                    stmt = stmt.filter(
                        EvaluationRunDBE.name.ilike(f"%{run.name}%"),
                    )

                if run.description is not None:
                    stmt = stmt.filter(
                        EvaluationRunDBE.description.ilike(f"%{run.description}%"),
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=EvaluationRunDBE,
                    attribute="id",  # UUID7
                    order="descending",  # jobs-style
                    windowing=windowing,
                )

            res = await session.execute(stmt)

            run_dbes = res.scalars().all()

            _runs = [
                create_dto_from_dbe(
                    DTO=EvaluationRun,
                    dbe=run_dbe,
                )
                for run_dbe in run_dbes
            ]

            return _runs

    @suppress_exceptions(default=[])
    async def fetch_live_runs(
        self,
        *,
        windowing: Optional[Windowing] = None,
    ) -> List[Tuple[UUID, EvaluationRun]]:
        async with engine.core_session() as session:
            stmt = select(EvaluationRunDBE)

            stmt = stmt.filter(
                not_(EvaluationRunDBE.flags.contains({"is_closed": True})),
            )

            stmt = stmt.filter(
                EvaluationRunDBE.flags.contains({"is_live": True}),
            )

            stmt = stmt.filter(
                EvaluationRunDBE.flags.contains({"is_active": True}),
            )

            stmt = stmt.filter(
                EvaluationRunDBE.status == "running",
            )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=EvaluationRunDBE,
                    attribute="id",  # UUID7
                    order="descending",  # jobs-style
                    windowing=windowing,
                )

            res = await session.execute(stmt)

            run_dbes = res.scalars().all()

            _runs = [
                (
                    UUID(str(run_dbe.project_id)),
                    create_dto_from_dbe(
                        DTO=EvaluationRun,
                        dbe=run_dbe,
                    ),
                )
                for run_dbe in run_dbes
            ]

            return _runs

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

        _scenario = EvaluationScenario(
            **scenario.model_dump(
                mode="json",
                exclude_none=True,
            ),
            created_at=datetime.now(timezone.utc),
            created_by_id=user_id,
        )

        scenario_dbe = create_dbe_from_dto(
            DBE=EvaluationScenarioDBE,
            project_id=project_id,
            dto=_scenario,
        )

        try:
            async with engine.core_session() as session:
                session.add(scenario_dbe)

                await session.commit()

                _scenario = create_dto_from_dbe(
                    DTO=EvaluationScenario,
                    dbe=scenario_dbe,
                )

                return _scenario

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

        _scenarios = [
            EvaluationScenario(
                **scenario.model_dump(
                    mode="json",
                    exclude_none=True,
                ),
                created_at=datetime.now(timezone.utc),
                created_by_id=user_id,
            )
            for scenario in scenarios
        ]

        scenario_dbes = [
            create_dbe_from_dto(
                DBE=EvaluationScenarioDBE,
                project_id=project_id,
                dto=_scenario,
            )
            for _scenario in _scenarios
        ]

        try:
            async with engine.core_session() as session:
                session.add_all(scenario_dbes)

                await session.commit()

                _scenarios = [
                    create_dto_from_dbe(
                        DTO=EvaluationScenario,
                        dbe=scenario_dbe,
                    )
                    for scenario_dbe in scenario_dbes
                ]

                return _scenarios

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
            )

            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.id == scenario_id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            scenario_dbe = res.scalars().first()

            if scenario_dbe is None:
                return None

            _scenario = create_dto_from_dbe(
                DTO=EvaluationScenario,
                dbe=scenario_dbe,
            )

            return _scenario

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
            )

            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.id.in_(scenario_ids),
            )

            stmt = stmt.limit(len(scenario_ids))

            res = await session.execute(stmt)

            scenario_dbes = res.scalars().all()

            _scenarios = [
                create_dto_from_dbe(
                    DTO=EvaluationScenario,
                    dbe=scenario_dbe,
                )
                for scenario_dbe in scenario_dbes
            ]

            return _scenarios

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
            )

            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.id == scenario.id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            scenario_dbe = res.scalars().first()

            if scenario_dbe is None:
                return None

            run_flags = await _get_run_flags(
                session=session,
                project_id=project_id,
                run_id=scenario_dbe.run_id,  # type: ignore
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=scenario_dbe.run_id,  # type: ignore
                    scenario_id=scenario_dbe.id,  # type: ignore
                )

            scenario_dbe = edit_dbe_from_dto(
                dbe=scenario_dbe,
                dto=scenario,
                updated_at=datetime.now(timezone.utc),
                updated_by_id=user_id,
            )

            await session.commit()

            _scenario = create_dto_from_dbe(
                DTO=EvaluationScenario,
                dbe=scenario_dbe,
            )

            return _scenario

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
            )

            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.id.in_(scenario_ids),
            )

            stmt = stmt.limit(len(scenario_ids))

            res = await session.execute(stmt)

            scenario_dbes = res.scalars().all()

            if not scenario_dbes:
                return []

            for scenario_dbe in scenario_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=scenario_dbe.run_id,  # type: ignore
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=scenario_dbe.run_id,  # type: ignore
                        scenario_id=scenario_dbe.id,  # type: ignore
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

            _scenarios = [
                create_dto_from_dbe(
                    DTO=EvaluationScenario,
                    dbe=scenario_dbe,
                )
                for scenario_dbe in scenario_dbes
            ]

            return _scenarios

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
            )

            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.id == scenario_id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            scenario_dbe = res.scalars().first()

            if not scenario_dbe:
                return None

            run_flags = await _get_run_flags(
                session=session,
                project_id=project_id,
                run_id=scenario_dbe.run_id,  # type: ignore
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=scenario_dbe.run_id,  # type: ignore
                    scenario_id=scenario_dbe.id,  # type: ignore
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
            )

            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.id.in_(scenario_ids),
            )

            stmt = stmt.limit(len(scenario_ids))

            res = await session.execute(stmt)

            scenario_dbes = res.scalars().all()

            if not scenario_dbes:
                return []

            for scenario_dbe in scenario_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=scenario_dbe.run_id,  # type: ignore
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=scenario_dbe.run_id,  # type: ignore
                        scenario_id=scenario_dbe.id,  # type: ignore
                    )

                await session.delete(scenario_dbe)

            await session.commit()

            scenario_ids = [scenario_dbe.id for scenario_dbe in scenario_dbes]  # type: ignore

            return scenario_ids

    @suppress_exceptions(default=[])
    async def query_scenarios(
        self,
        *,
        project_id: UUID,
        #
        scenario: Optional[EvaluationScenarioQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationScenario]:
        async with engine.core_session() as session:
            stmt = select(EvaluationScenarioDBE).filter(
                EvaluationScenarioDBE.project_id == project_id,
            )

            if scenario is not None:
                if scenario.ids is not None:
                    stmt = stmt.filter(
                        EvaluationScenarioDBE.id.in_(scenario.ids),
                    )

                if scenario.run_id is not None:
                    stmt = stmt.filter(
                        EvaluationScenarioDBE.run_id == scenario.run_id,
                    )

                if scenario.run_ids is not None:
                    stmt = stmt.filter(
                        EvaluationScenarioDBE.run_id.in_(scenario.run_ids),
                    )

                if scenario.timestamp is not None:
                    stmt = stmt.filter(
                        EvaluationScenarioDBE.timestamp == scenario.timestamp,
                    )

                if scenario.timestamps is not None:
                    stmt = stmt.filter(
                        EvaluationScenarioDBE.timestamp.in_(scenario.timestamps),
                    )

                if scenario.interval is not None:
                    stmt = stmt.filter(
                        EvaluationScenarioDBE.interval == scenario.interval,
                    )

                if scenario.intervals is not None:
                    stmt = stmt.filter(
                        EvaluationScenarioDBE.interval.in_(scenario.intervals),
                    )

                if scenario.flags is not None:
                    stmt = stmt.filter(
                        EvaluationScenarioDBE.flags.contains(scenario.flags),
                    )

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

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=EvaluationScenarioDBE,
                    attribute="id",  # UUID7
                    order="ascending",  # data-style
                    windowing=windowing,
                )

            res = await session.execute(stmt)

            scenario_dbes = res.scalars().all()

            _scenarios = [
                create_dto_from_dbe(
                    DTO=EvaluationScenario,
                    dbe=scenario_dbe,
                )
                for scenario_dbe in scenario_dbes
            ]

            return _scenarios

    # - EVALUATION RESULT ------------------------------------------------------

    @suppress_exceptions(exclude=[EntityCreationConflict])
    async def create_result(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        result: EvaluationResultCreate,
    ) -> Optional[EvaluationResult]:
        run_flags = await _get_run_flags(
            project_id=project_id,
            run_id=result.run_id,
        )

        if run_flags.get("is_closed", False):
            raise EvaluationClosedConflict(
                run_id=result.run_id,
            )

        _result = EvaluationResult(
            **result.model_dump(
                mode="json",
                exclude_none=True,
            ),
            created_at=datetime.now(timezone.utc),
            created_by_id=user_id,
        )

        result_dbe = create_dbe_from_dto(
            DBE=EvaluationResultDBE,
            project_id=project_id,
            dto=_result,
        )

        try:
            async with engine.core_session() as session:
                session.add(result_dbe)

                await session.commit()

                _result = create_dto_from_dbe(
                    DTO=EvaluationResult,
                    dbe=result_dbe,
                )

                return _result

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions(default=[], exclude=[EntityCreationConflict])
    async def create_results(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        results: List[EvaluationResultCreate],
    ) -> List[EvaluationResult]:
        for result in results:
            run_flags = await _get_run_flags(
                project_id=project_id,
                run_id=result.run_id,
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=result.run_id,
                )

        async with engine.core_session() as session:
            _results = [
                EvaluationResult(
                    **result.model_dump(
                        mode="json",
                        exclude_none=True,
                    ),
                    created_at=datetime.now(timezone.utc),
                    created_by_id=user_id,
                )
                for result in results
            ]

            result_dbes = [
                create_dbe_from_dto(
                    DBE=EvaluationResultDBE,
                    project_id=project_id,
                    dto=_result,
                )
                for _result in _results
            ]

            session.add_all(result_dbes)

            await session.commit()

            _results = [
                create_dto_from_dbe(
                    DTO=EvaluationResult,
                    dbe=result_dbe,
                )
                for result_dbe in result_dbes
            ]

            return _results

    @suppress_exceptions()
    async def fetch_result(
        self,
        *,
        project_id: UUID,
        #
        result_id: UUID,
    ) -> Optional[EvaluationResult]:
        async with engine.core_session() as session:
            stmt = select(EvaluationResultDBE).filter(
                EvaluationResultDBE.project_id == project_id,
            )

            stmt = select(EvaluationResultDBE).filter(
                EvaluationResultDBE.id == result_id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            result_dbe = res.scalars().first()

            if result_dbe is None:
                return None

            _result = create_dto_from_dbe(
                DTO=EvaluationResult,
                dbe=result_dbe,
            )

            return _result

    @suppress_exceptions(default=[])
    async def fetch_results(
        self,
        *,
        project_id: UUID,
        #
        result_ids: List[UUID],
    ) -> List[EvaluationResult]:
        async with engine.core_session() as session:
            stmt = select(EvaluationResultDBE).filter(
                EvaluationResultDBE.project_id == project_id,
            )

            stmt = select(EvaluationResultDBE).filter(
                EvaluationResultDBE.id.in_(result_ids),
            )

            stmt = stmt.limit(len(result_ids))

            res = await session.execute(stmt)

            result_dbes = res.scalars().all()

            _results = [
                create_dto_from_dbe(
                    DTO=EvaluationResult,
                    dbe=result_dbe,
                )
                for result_dbe in result_dbes
            ]

            return _results

    @suppress_exceptions()
    async def edit_result(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        result: EvaluationResultEdit,
    ) -> Optional[EvaluationResult]:
        async with engine.core_session() as session:
            stmt = select(EvaluationResultDBE).filter(
                EvaluationResultDBE.project_id == project_id,
            )

            stmt = select(EvaluationResultDBE).filter(
                EvaluationResultDBE.id == result.id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            result_dbe = res.scalars().first()

            if result_dbe is None:
                return None

            run_flags = await _get_run_flags(
                session=session,
                project_id=project_id,
                run_id=result_dbe.run_id,  # type: ignore
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=result_dbe.run_id,  # type: ignore
                    scenario_id=result_dbe.scenario_id,  # type: ignore
                    result_id=result_dbe.id,  # type: ignore
                )

            result_dbe = edit_dbe_from_dto(
                dbe=result_dbe,
                dto=result,
                updated_at=datetime.now(timezone.utc),
                updated_by_id=user_id,
            )

            await session.commit()

            _result = create_dto_from_dbe(
                DTO=EvaluationResult,
                dbe=result_dbe,
            )

            return _result

    @suppress_exceptions(default=[])
    async def edit_results(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        results: List[EvaluationResultEdit],
    ) -> List[EvaluationResult]:
        result_ids = [result.id for result in results]

        async with engine.core_session() as session:
            stmt = select(EvaluationResultDBE).filter(
                EvaluationResultDBE.project_id == project_id,
            )

            stmt = select(EvaluationResultDBE).filter(
                EvaluationResultDBE.id.in_(result_ids),
            )

            stmt = stmt.limit(len(result_ids))

            res = await session.execute(stmt)

            result_dbes = res.scalars().all()

            if not result_dbes:
                return []

            for result_dbe in result_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=result_dbe.run_id,  # type: ignore
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=result_dbe.run_id,  # type: ignore
                        scenario_id=result_dbe.scenario_id,  # type: ignore
                        result_id=result_dbe.id,  # type: ignore
                    )

                result = next(
                    (s for s in results if s.id == result_dbe.id),
                    None,
                )

                if result is not None:
                    result_dbe = edit_dbe_from_dto(
                        dbe=result_dbe,
                        dto=result,
                        updated_at=datetime.now(timezone.utc),
                        updated_by_id=user_id,
                    )

            await session.commit()

            _results = [
                create_dto_from_dbe(
                    DTO=EvaluationResult,
                    dbe=result_dbe,
                )
                for result_dbe in result_dbes
            ]

            return _results

    @suppress_exceptions()
    async def delete_result(
        self,
        *,
        project_id: UUID,
        #
        result_id: UUID,
    ) -> Optional[UUID]:
        async with engine.core_session() as session:
            stmt = select(EvaluationResultDBE).filter(
                EvaluationResultDBE.project_id == project_id,
            )

            stmt = select(EvaluationResultDBE).filter(
                EvaluationResultDBE.id == result_id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            result_dbe = res.scalars().first()

            if result_dbe is None:
                return None

            run_flags = await _get_run_flags(
                session=session,
                project_id=project_id,
                run_id=result_dbe.run_id,  # type: ignore
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=result_dbe.run_id,  # type: ignore
                    scenario_id=result_dbe.scenario_id,  # type: ignore
                    result_id=result_dbe.id,  # type: ignore
                )

            await session.delete(result_dbe)

            await session.commit()

            return result_id

    @suppress_exceptions(default=[])
    async def delete_results(
        self,
        *,
        project_id: UUID,
        #
        result_ids: List[UUID],
    ) -> List[UUID]:
        async with engine.core_session() as session:
            stmt = select(EvaluationResultDBE).filter(
                EvaluationResultDBE.project_id == project_id,
            )

            stmt = select(EvaluationResultDBE).filter(
                EvaluationResultDBE.id.in_(result_ids),
            )

            stmt = stmt.limit(len(result_ids))

            res = await session.execute(stmt)

            result_dbes = res.scalars().all()

            if not result_dbes:
                return []

            for result_dbe in result_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=result_dbe.run_id,  # type: ignore
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=result_dbe.run_id,  # type: ignore
                        scenario_id=result_dbe.scenario_id,  # type: ignore
                        result_id=result_dbe.id,  # type: ignore
                    )

                await session.delete(result_dbe)

            await session.commit()

            return result_ids

    @suppress_exceptions(default=[])
    async def query_results(
        self,
        *,
        project_id: UUID,
        #
        result: Optional[EvaluationResultQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationResult]:
        async with engine.core_session() as session:
            stmt = select(EvaluationResultDBE).filter(
                EvaluationResultDBE.project_id == project_id,
            )

            if result is not None:
                if result.ids is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.id.in_(result.ids),
                    )

                if result.run_id is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.run_id == result.run_id,
                    )

                if result.run_ids is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.run_id.in_(result.run_ids),
                    )

                if result.scenario_id is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.scenario_id == result.scenario_id,
                    )

                if result.scenario_ids is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.scenario_id.in_(result.scenario_ids),
                    )

                if result.step_key is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.step_key == result.step_key,
                    )

                if result.step_keys is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.step_key.in_(result.step_keys),
                    )

                if result.repeat_idx is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.repeat_idx == result.repeat_idx,
                    )

                if result.repeat_idxs is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.repeat_idx.in_(result.repeat_idxs),
                    )

                if result.timestamp is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.timestamp == result.timestamp,
                    )

                if result.timestamps is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.timestamp.in_(result.timestamps),
                    )

                if result.interval is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.interval == result.interval,
                    )

                if result.intervals is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.interval.in_(result.intervals),
                    )

                if result.flags is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.flags.contains(result.flags),
                    )

                if result.tags is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.tags.contains(result.tags),
                    )

                if result.meta is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.meta.contains(result.meta),
                    )

                if result.status is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.status == result.status,
                    )

                if result.statuses is not None:
                    stmt = stmt.filter(
                        EvaluationResultDBE.status.in_(result.statuses),
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=EvaluationResultDBE,
                    attribute="id",  # UUID7
                    order="ascending",  # data-style
                    windowing=windowing,
                )

            res = await session.execute(stmt)

            result_dbes = res.scalars().all()

            results = [
                create_dto_from_dbe(
                    DTO=EvaluationResult,
                    dbe=result_dbe,
                )
                for result_dbe in result_dbes
            ]

            return results

    # - EVALUATION METRICS -----------------------------------------------------

    @suppress_exceptions(default=[], exclude=[EntityCreationConflict])
    async def create_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metrics: List[EvaluationMetricsCreate],
    ) -> List[EvaluationMetrics]:
        for metric in metrics:
            run_flags = await _get_run_flags(
                project_id=project_id,
                run_id=metric.run_id,
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=metric.run_id,
                )

        _metrics = [
            EvaluationMetrics(
                **metric.model_dump(
                    mode="json",
                    exclude_none=True,
                ),
                created_at=datetime.now(timezone.utc),
                created_by_id=user_id,
            )
            for metric in metrics
        ]

        metric_dbes = [
            create_dbe_from_dto(
                DBE=EvaluationMetricsDBE,
                project_id=project_id,
                dto=_metric,
            )
            for _metric in _metrics
        ]

        try:
            async with engine.core_session() as session:
                session.add_all(metric_dbes)

                await session.commit()

                _metrics = [
                    create_dto_from_dbe(
                        DTO=EvaluationMetrics,
                        dbe=metric_dbe,
                    )
                    for metric_dbe in metric_dbes
                ]

                return _metrics

        except Exception as e:
            check_entity_creation_conflict(e)

            raise

    @suppress_exceptions(default=[])
    async def fetch_metrics(
        self,
        *,
        project_id: UUID,
        #
        metrics_ids: List[UUID],
    ) -> List[EvaluationMetrics]:
        async with engine.core_session() as session:
            stmt = select(EvaluationMetricsDBE).filter(
                EvaluationMetricsDBE.project_id == project_id,
            )

            stmt = select(EvaluationMetricsDBE).filter(
                EvaluationMetricsDBE.id.in_(metrics_ids),
            )

            stmt = stmt.limit(len(metrics_ids))

            res = await session.execute(stmt)

            metric_dbes = res.scalars().all()

            _metrics = [
                create_dto_from_dbe(
                    DTO=EvaluationMetrics,
                    dbe=metric_dbe,
                )
                for metric_dbe in metric_dbes
            ]

            return _metrics

    @suppress_exceptions(default=[])
    async def edit_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        metrics: List[EvaluationMetricsEdit],
    ) -> List[EvaluationMetrics]:
        metrics_ids = [metric.id for metric in metrics]

        async with engine.core_session() as session:
            stmt = select(EvaluationMetricsDBE).filter(
                EvaluationMetricsDBE.project_id == project_id,
            )

            stmt = select(EvaluationMetricsDBE).filter(
                EvaluationMetricsDBE.id.in_(metrics_ids),
            )

            stmt = stmt.limit(len(metrics_ids))

            res = await session.execute(stmt)

            metric_dbes = res.scalars().all()

            if not metric_dbes:
                return []

            for metric_dbe in metric_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=metric_dbe.run_id,  # type: ignore
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=metric_dbe.run_id,  # type: ignore
                        scenario_id=metric_dbe.scenario_id,  # type: ignore
                        metrics_id=metric_dbe.id,  # type: ignore
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

            _metrics = [
                create_dto_from_dbe(
                    DTO=EvaluationMetrics,
                    dbe=metric_dbe,
                )
                for metric_dbe in metric_dbes
            ]

            return _metrics

    @suppress_exceptions(default=[])
    async def delete_metrics(
        self,
        *,
        project_id: UUID,
        #
        metrics_ids: Optional[List[UUID]] = None,
    ) -> List[UUID]:
        async with engine.core_session() as session:
            if metrics_ids is None:
                return []

            stmt = select(EvaluationMetricsDBE).filter(
                EvaluationMetricsDBE.project_id == project_id,
            )

            stmt = select(EvaluationMetricsDBE).filter(
                EvaluationMetricsDBE.id.in_(metrics_ids),
            )

            stmt = stmt.limit(len(metrics_ids))

            res = await session.execute(stmt)

            metric_dbes = res.scalars().all()

            if not metric_dbes:
                return []

            for metric_dbe in metric_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=metric_dbe.run_id,  # type: ignore
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=metric_dbe.run_id,  # type: ignore
                        scenario_id=metric_dbe.scenario_id,  # type: ignore
                        metrics_id=metric_dbe.id,  # type: ignore
                    )

                await session.delete(metric_dbe)

            await session.commit()

            return metrics_ids

    @suppress_exceptions(default=[])
    async def query_metrics(
        self,
        *,
        project_id: UUID,
        #
        metric: Optional[EvaluationMetricsQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationMetrics]:
        async with engine.core_session() as session:
            stmt = select(EvaluationMetricsDBE).filter(
                EvaluationMetricsDBE.project_id == project_id,
            )

            if metric is not None:
                if metric.ids is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.id.in_(metric.ids),
                    )

                if metric.run_id is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.run_id == metric.run_id,
                    )

                if metric.run_ids is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.run_id.in_(metric.run_ids),
                    )

                if metric.scenario_id is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.scenario_id == metric.scenario_id,
                    )

                if metric.scenario_ids is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.scenario_id.in_(metric.scenario_ids),
                    )

                if metric.timestamp is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.timestamp == metric.timestamp,
                    )

                if metric.timestamps is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.timestamp.in_(metric.timestamps),
                    )

                if metric.interval is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.interval == metric.interval,
                    )

                if metric.intervals is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.interval.in_(metric.intervals),
                    )

                if metric.flags is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.flags.contains(metric.flags),
                    )

                if metric.tags is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.tags.contains(metric.tags),
                    )

                if metric.meta is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.meta.contains(metric.meta),
                    )

                if metric.status is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.status == metric.status,
                    )

                if metric.statuses is not None:
                    stmt = stmt.filter(
                        EvaluationMetricsDBE.status.in_(metric.statuses),
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=EvaluationMetricsDBE,
                    attribute="id",  # UUID7
                    order="descending",  # jobs-style
                    windowing=windowing,
                )

            res = await session.execute(stmt)

            metric_dbes = res.scalars().all()

            metrics = [
                create_dto_from_dbe(
                    DTO=EvaluationMetrics,
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

        _queue = EvaluationQueue(
            **queue.model_dump(
                mode="json",
                exclude_none=True,
            ),
            created_at=datetime.now(timezone.utc),
            created_by_id=user_id,
        )

        if _queue.data and _queue.data.user_ids:
            _queue.data.user_ids = [  # type: ignore
                [str(repeat_user_id) for repeat_user_id in repeat_user_ids]
                for repeat_user_ids in _queue.data.user_ids
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

                _queue = create_dto_from_dbe(
                    DTO=EvaluationQueue,
                    dbe=queue_dbe,
                )

                return _queue

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

        _queues = [
            EvaluationQueue(
                **queue.model_dump(
                    mode="json",
                    exclude_none=True,
                ),
                created_at=datetime.now(timezone.utc),
                created_by_id=user_id,
            )
            for queue in queues
        ]

        for _queue in _queues:
            if _queue.data and _queue.data.user_ids:
                _queue.data.user_ids = [  # type: ignore
                    [str(repeat_user_id) for repeat_user_id in repeat_user_ids]
                    for repeat_user_ids in _queue.data.user_ids
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

                _queues = [
                    create_dto_from_dbe(
                        DTO=EvaluationQueue,
                        dbe=queue_dbe,
                    )
                    for queue_dbe in queue_dbes
                ]

                return _queues

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
            )

            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.id == queue_id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            queue_dbe = res.scalars().first()

            if queue_dbe is None:
                return None

            _queue = create_dto_from_dbe(
                DTO=EvaluationQueue,
                dbe=queue_dbe,
            )

            return _queue

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
            )

            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.id.in_(queue_ids),
            )

            stmt = stmt.limit(len(queue_ids))

            res = await session.execute(stmt)

            queue_dbes = res.scalars().all()

            _queues = [
                create_dto_from_dbe(
                    DTO=EvaluationQueue,
                    dbe=queue_dbe,
                )
                for queue_dbe in queue_dbes
            ]

            return _queues

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
            )

            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.id == queue.id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            queue_dbe = res.scalars().first()

            if queue_dbe is None:
                return None

            run_flags = await _get_run_flags(
                session=session,
                project_id=project_id,
                run_id=queue_dbe.run_id,  # type: ignore
            )

            if run_flags.get("is_closed", False):
                raise EvaluationClosedConflict(
                    run_id=queue_dbe.run_id,
                    queue_id=queue_dbe.id,  # type: ignore
                )

            queue_dbe = edit_dbe_from_dto(
                dbe=queue_dbe,
                dto=queue,
                updated_at=datetime.now(timezone.utc),
                updated_by_id=user_id,
            )

            await session.commit()

            _queue = create_dto_from_dbe(
                DTO=EvaluationQueue,
                dbe=queue_dbe,
            )

            return _queue

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
            )

            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.id.in_(queue_ids),
            )

            stmt = stmt.limit(len(queue_ids))

            res = await session.execute(stmt)

            queue_dbes = res.scalars().all()

            if not queue_dbes:
                return []

            for queue_dbe in queue_dbes:
                run_flags = await _get_run_flags(
                    session=session,
                    project_id=project_id,
                    run_id=queue_dbe.run_id,  # type: ignore
                )

                if run_flags.get("is_closed", False):
                    raise EvaluationClosedConflict(
                        run_id=queue_dbe.run_id,
                        queue_id=queue_dbe.id,  # type: ignore
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

            _queues = [
                create_dto_from_dbe(
                    DTO=EvaluationQueue,
                    dbe=queue_dbe,
                )
                for queue_dbe in queue_dbes
            ]

            return _queues

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
            )

            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.id == queue_id,
            )

            stmt = stmt.limit(1)

            res = await session.execute(stmt)

            queue_dbe = res.scalars().first()

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
            )

            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.id.in_(queue_ids),
            )

            stmt = stmt.limit(len(queue_ids))

            res = await session.execute(stmt)

            queue_dbes = res.scalars().all()

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
        queue: Optional[EvaluationQueueQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[EvaluationQueue]:
        async with engine.core_session() as session:
            stmt = select(EvaluationQueueDBE).filter(
                EvaluationQueueDBE.project_id == project_id,
            )

            if queue is not None:
                if queue.ids is not None:
                    stmt = stmt.filter(
                        EvaluationQueueDBE.id.in_(queue.ids),
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
                        EvaluationQueueDBE.flags.contains(queue.flags),
                    )

                if queue.tags is not None:
                    stmt = stmt.filter(
                        EvaluationQueueDBE.tags.contains(queue.tags),
                    )

                if queue.meta is not None:
                    stmt = stmt.filter(
                        EvaluationQueueDBE.meta.contains(queue.meta),
                    )

                if queue.name is not None:
                    stmt = stmt.filter(
                        EvaluationQueueDBE.name.contains(queue.name),
                    )

                if queue.description is not None:
                    stmt = stmt.filter(
                        EvaluationQueueDBE.description.contains(queue.description),
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=EvaluationQueueDBE,
                    attribute="id",  # UUID7
                    order="descending",  # jobs-style
                    windowing=windowing,
                )

            res = await session.execute(stmt)

            queue_dbes = res.scalars().all()

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
    )
    stmt = select(EvaluationRunDBE.flags).filter(
        EvaluationRunDBE.id == run_id,
    )

    res = await session.execute(stmt)

    run_flags = res.scalars().first()

    return run_flags or {}
