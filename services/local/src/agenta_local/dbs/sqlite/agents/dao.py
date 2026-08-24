"""SQLite implementation of the agents DAO contract.

Reads go through plain sessions; every write runs inside immediate_transaction so
invariant reads (max version, current-revision ownership) are serialized.
"""

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, async_sessionmaker

from agenta_local.core.agents.dtos import Agent, AgentRevision
from agenta_local.core.agents.interfaces import AgentsDAOInterface
from agenta_local.core.agents.types import AgentInUse, AgentNotFound, RevisionNotFound
from agenta_local.dbs.sqlite.agents.dbes import AgentDBE, AgentRevisionDBE
from agenta_local.dbs.sqlite.agents.mappings import dbe_to_agent, dbe_to_revision
from agenta_local.dbs.sqlite.shared.engine import fetch_one, immediate_transaction
from agenta_local.dbs.sqlite.shared.types import new_id


class AgentsDAO(AgentsDAOInterface):
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._factory = session_factory

    async def create_agent(
        self,
        *,
        name: str,
        instructions: str,
        model_json: str,
        execution_json: str,
    ) -> Agent:
        agent_id = new_id("agt")
        revision_id = new_id("rev")
        # One transaction closes the deferrable current_revision <-> revision FK cycle.
        async with immediate_transaction(self._factory) as conn:
            await conn.execute(
                insert(AgentRevisionDBE).values(
                    id=revision_id,
                    agent_id=agent_id,
                    version=1,
                    instructions=instructions,
                    model_json=model_json,
                    execution_json=execution_json,
                )
            )
            await conn.execute(
                insert(AgentDBE).values(
                    id=agent_id, name=name, current_revision_id=revision_id
                )
            )
            return await _load_agent(conn, agent_id)

    async def get_agent(self, *, agent_id: str) -> Agent | None:
        async with self._factory() as session:
            dbe = await session.get(AgentDBE, agent_id)
            if dbe is None:
                return None
            revision = await session.get(AgentRevisionDBE, dbe.current_revision_id)
            if revision is None:
                raise AgentNotFound(
                    f"agent {agent_id} points at missing revision"
                    f" {dbe.current_revision_id}"
                )
            return dbe_to_agent(dbe, current_revision=revision)

    async def list_agents(self) -> list[Agent]:
        async with self._factory() as session:
            agents = (
                (
                    await session.execute(
                        select(AgentDBE).order_by(
                            AgentDBE.updated_at.desc(), AgentDBE.id.asc()
                        )
                    )
                )
                .scalars()
                .all()
            )
            if not agents:
                return []
            revisions = {
                dbe.id: dbe
                for dbe in (
                    (
                        await session.execute(
                            select(AgentRevisionDBE).where(
                                AgentRevisionDBE.id.in_(
                                    [a.current_revision_id for a in agents]
                                )
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
            }
            return [
                dbe_to_agent(dbe, current_revision=revisions[dbe.current_revision_id])
                for dbe in agents
            ]

    async def rename_agent(self, *, agent_id: str, name: str) -> Agent:
        async with immediate_transaction(self._factory) as conn:
            await _require_agent(conn, agent_id)
            await conn.execute(
                update(AgentDBE).where(AgentDBE.id == agent_id).values(name=name)
            )
            return await _load_agent(conn, agent_id)

    async def delete_agent(self, *, agent_id: str) -> None:
        try:
            async with immediate_transaction(self._factory) as conn:
                await _require_agent(conn, agent_id)
                # Sessions RESTRICT the revision rows; deleting both together fails
                # only when history still references them.
                await conn.execute(delete(AgentDBE).where(AgentDBE.id == agent_id))
                await conn.execute(
                    delete(AgentRevisionDBE).where(
                        AgentRevisionDBE.agent_id == agent_id
                    )
                )
        except IntegrityError as exc:
            raise AgentInUse(f"agent {agent_id} still has dependent sessions") from exc

    async def set_current_revision(self, *, agent_id: str, revision_id: str) -> Agent:
        async with immediate_transaction(self._factory) as conn:
            await _require_agent(conn, agent_id)
            revision = await fetch_one(
                conn,
                select(AgentRevisionDBE).where(AgentRevisionDBE.id == revision_id),
                AgentRevisionDBE,
            )
            if revision is None or revision.agent_id != agent_id:
                raise RevisionNotFound(
                    f"revision {revision_id} does not belong to agent {agent_id}"
                )
            await conn.execute(
                update(AgentDBE)
                .where(AgentDBE.id == agent_id)
                .values(current_revision_id=revision_id)
            )
            return await _load_agent(conn, agent_id)

    async def create_revision(
        self,
        *,
        agent_id: str,
        instructions: str,
        model_json: str,
        execution_json: str,
    ) -> AgentRevision:
        async with immediate_transaction(self._factory) as conn:
            await _require_agent(conn, agent_id)
            max_version = (
                await conn.execute(
                    select(func.coalesce(func.max(AgentRevisionDBE.version), 0)).where(
                        AgentRevisionDBE.agent_id == agent_id
                    )
                )
            ).scalar_one()
            revision_id = new_id("rev")
            await conn.execute(
                insert(AgentRevisionDBE).values(
                    id=revision_id,
                    agent_id=agent_id,
                    version=max_version + 1,
                    instructions=instructions,
                    model_json=model_json,
                    execution_json=execution_json,
                )
            )
            await conn.execute(
                update(AgentDBE)
                .where(AgentDBE.id == agent_id)
                .values(current_revision_id=revision_id)
            )
            return dbe_to_revision(
                await fetch_one(
                    conn,
                    select(AgentRevisionDBE).where(AgentRevisionDBE.id == revision_id),
                    AgentRevisionDBE,
                )
            )

    async def get_revision(self, *, revision_id: str) -> AgentRevision | None:
        async with self._factory() as session:
            dbe = await session.get(AgentRevisionDBE, revision_id)
            return None if dbe is None else dbe_to_revision(dbe)

    async def list_revisions(self, *, agent_id: str) -> list[AgentRevision]:
        async with self._factory() as session:
            dbes = (
                (
                    await session.execute(
                        select(AgentRevisionDBE)
                        .where(AgentRevisionDBE.agent_id == agent_id)
                        .order_by(AgentRevisionDBE.version.desc())
                    )
                )
                .scalars()
                .all()
            )
            return [dbe_to_revision(dbe) for dbe in dbes]


async def _require_agent(conn: AsyncConnection, agent_id: str) -> None:
    exists = (
        await conn.execute(select(AgentDBE.id).where(AgentDBE.id == agent_id))
    ).scalar()
    if exists is None:
        raise AgentNotFound(f"agent {agent_id} does not exist")


async def _load_agent(conn: AsyncConnection, agent_id: str) -> Agent:
    dbe = await fetch_one(
        conn, select(AgentDBE).where(AgentDBE.id == agent_id), AgentDBE
    )
    revision = await fetch_one(
        conn,
        select(AgentRevisionDBE).where(AgentRevisionDBE.id == dbe.current_revision_id),
        AgentRevisionDBE,
    )
    return dbe_to_agent(dbe, current_revision=revision)
