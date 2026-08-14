"""What the commit path STORES, read back from the database and not from the response.

This file exists because of a live data loss. A full-data commit on a fresh variant
answered 200, and the stored row held NULL. `read_config` then reported that the variant
had no revision at all, so the configuration a user had just saved was gone.

Every existing commit test asserted on the response, and the response is built from the
object the service assembled. That is why 1939 green tests did not see it. The only
assertion that catches this class is a read of the row through a different connection.

The cause was the version-0 rule in `commit_revision`: version 0 is the empty placeholder a
variant is seeded with, and its fields are nulled so a reader can tell "not configured yet"
from "configured empty". It fired for ANY first revision, including one carrying a real
payload. Flows that commit twice never saw it, because the second commit is version 1.

Runs where Postgres exists; skipped otherwise by the conftest probe beside this file.
"""

import json
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from oss.src.core.shared.dtos import Reference
from oss.src.dbs.postgres.shared.engine import TransactionsEngine

pytestmark = pytest.mark.integration


AGENT_DATA = {
    "parameters": {
        "agent": {
            "instructions": {"agents_md": "# Release agent\n\nBe brief.\n"},
            "llm": {"model": "anthropic/claude-sonnet-5", "max_tokens": 8192},
        }
    }
}


@pytest.fixture
async def engine():
    """One engine per test, on the loop the test runs on."""
    instance = TransactionsEngine()
    try:
        yield instance
    finally:
        await instance.close()


async def _exec(engine, sql, params=None):
    async with engine.session() as session:
        return await session.execute(text(sql), params or {})


@pytest.fixture
async def variant(engine):
    """A fresh artifact and variant with NO revisions, borrowed onto a live project."""
    result = await _exec(
        engine,
        "SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1",
    )
    project_id = result.scalar_one_or_none()
    if project_id is None:
        pytest.skip("no project in the target database to attach the fixture to")

    artifact_id, variant_id = uuid4(), uuid4()
    await _exec(
        engine,
        "INSERT INTO workflow_artifacts (id, project_id, slug, created_at) "
        "VALUES (:id, :project_id, :slug, now())",
        {"id": artifact_id, "project_id": project_id, "slug": f"a-{artifact_id.hex}"},
    )
    await _exec(
        engine,
        "INSERT INTO workflow_variants (id, project_id, artifact_id, slug, created_at) "
        "VALUES (:id, :project_id, :artifact_id, :slug, now())",
        {
            "id": variant_id,
            "project_id": project_id,
            "artifact_id": artifact_id,
            "slug": f"v-{variant_id.hex}",
        },
    )
    yield {"project_id": project_id, "artifact_id": artifact_id, "id": variant_id}
    for table, column, target in (
        ("workflow_revisions", "variant_id", variant_id),
        ("workflow_variants", "id", variant_id),
        ("workflow_artifacts", "id", artifact_id),
    ):
        await _exec(
            engine, f"DELETE FROM {table} WHERE {column} = :target", {"target": target}
        )


def _service(engine):
    import oss.src.models.db_models  # noqa: F401  (registers `projects` for the FKs)
    from oss.src.core.workflows.service import WorkflowsService
    from oss.src.dbs.postgres.git.dao import GitDAO
    from oss.src.dbs.postgres.workflows.dbes import (
        WorkflowArtifactDBE,
        WorkflowRevisionDBE,
        WorkflowVariantDBE,
    )

    return WorkflowsService(
        workflows_dao=GitDAO(
            ArtifactDBE=WorkflowArtifactDBE,
            VariantDBE=WorkflowVariantDBE,
            RevisionDBE=WorkflowRevisionDBE,
            engine=engine,
        )
    )


async def _commit(service, variant, **kwargs):
    from oss.src.core.workflows.dtos import WorkflowRevisionCommit

    return await service.commit_workflow_revision_checked(
        project_id=variant["project_id"],
        user_id=uuid4(),
        workflow_revision_commit=WorkflowRevisionCommit(
            workflow_variant_id=variant["id"], **kwargs
        ),
    )


async def _stored_data(engine, revision_id: UUID):
    """The row as the database holds it, read independently of the response."""
    result = await _exec(
        engine,
        "SELECT data FROM workflow_revisions WHERE id = :id",
        {"id": revision_id},
    )
    row = result.scalar_one_or_none()
    return json.loads(row) if isinstance(row, str) else row


class TestAFullDataCommitStoresItsData:
    async def test_the_first_commit_on_a_fresh_variant_stores_its_data(
        self, engine, variant
    ):
        from oss.src.core.workflows.dtos import WorkflowRevisionData

        outcome = await _commit(
            _service(engine),
            variant,
            data=WorkflowRevisionData(**AGENT_DATA),
            message="seed",
        )

        assert outcome.status == "committed"
        assert outcome.revision is not None
        stored = await _stored_data(engine, outcome.revision.id)
        assert stored is not None, "the stored row holds NULL: the commit lost its data"
        assert stored["parameters"] == AGENT_DATA["parameters"]

    async def test_the_response_and_the_stored_row_agree(self, engine, variant):
        # The response is built from the object the service assembled. Asserting on it
        # alone is what let the loss through, so this pins the two together.
        from oss.src.core.workflows.dtos import WorkflowRevisionData

        outcome = await _commit(
            _service(engine), variant, data=WorkflowRevisionData(**AGENT_DATA)
        )

        echoed = outcome.revision.data.model_dump(mode="json", exclude_none=True)
        stored = await _stored_data(engine, outcome.revision.id)
        assert stored == echoed

    async def test_an_empty_first_commit_is_still_the_seed(self, engine, variant):
        # The placeholder convention survives: a first commit that carries nothing is
        # still stored empty, so a reader can tell "not configured yet" from
        # "configured empty".
        outcome = await _commit(_service(engine), variant, message="Initial revision")

        assert outcome.revision is not None
        assert await _stored_data(engine, outcome.revision.id) is None

    async def test_a_second_commit_stores_its_data_too(self, engine, variant):
        from oss.src.core.workflows.dtos import WorkflowRevisionData

        service = _service(engine)
        await _commit(service, variant, message="Initial revision")
        outcome = await _commit(
            service, variant, data=WorkflowRevisionData(**AGENT_DATA)
        )

        stored = await _stored_data(engine, outcome.revision.id)
        assert stored["parameters"] == AGENT_DATA["parameters"]


class TestTheDeltaPathStoresItsData:
    async def test_a_delta_commit_on_a_fresh_variant_stores_its_result(
        self, engine, variant
    ):
        service = _service(engine)
        outcome = await _commit(
            service,
            variant,
            delta={"set": AGENT_DATA},
            message="from a delta",
        )

        stored = await _stored_data(engine, outcome.revision.id)
        assert stored is not None, "the delta path lost its data"
        assert stored["parameters"] == AGENT_DATA["parameters"]

    async def test_a_delta_on_top_of_a_stored_revision_keeps_the_rest(
        self, engine, variant
    ):
        from oss.src.core.workflows.dtos import WorkflowRevisionData

        service = _service(engine)
        first = await _commit(service, variant, data=WorkflowRevisionData(**AGENT_DATA))
        second = await _commit(
            service,
            variant,
            base_revision_id=first.revision.id,
            delta={"set": {"parameters": {"agent": {"llm": {"model": "opus"}}}}},
        )

        stored = await _stored_data(engine, second.revision.id)
        agent = stored["parameters"]["agent"]
        assert agent["llm"]["model"] == "opus"
        assert agent["llm"]["max_tokens"] == 8192, "the delta dropped a sibling field"
        assert agent["instructions"]["agents_md"].startswith("# Release agent")


class TestReadConfigSeesWhatWasStored:
    async def test_a_seeded_variant_can_be_read_back(self, engine, variant):
        # The user-visible symptom: commit answered 200, then read_config reported that
        # the variant had no revision to read.
        from oss.src.core.workflows.dtos import WorkflowRevisionData

        service = _service(engine)
        await _commit(service, variant, data=WorkflowRevisionData(**AGENT_DATA))

        outcome = await service.read_workflow_revision_config(
            project_id=variant["project_id"],
            workflow_variant_id=variant["id"],
            path=None,
        )

        assert outcome.value["parameters"]["agent"]["llm"]["model"] == (
            "anthropic/claude-sonnet-5"
        )

    async def test_the_head_the_reader_resolves_carries_the_data(self, engine, variant):
        from oss.src.core.workflows.dtos import WorkflowRevisionData

        service = _service(engine)
        await _commit(service, variant, data=WorkflowRevisionData(**AGENT_DATA))

        head = await service.fetch_workflow_revision(
            project_id=variant["project_id"],
            workflow_variant_ref=Reference(id=variant["id"]),
            include_archived=False,
        )

        assert head is not None and head.data is not None


class TestThePlatformGuidanceOnTheTwoPaths:
    """The strip belongs to the agent's path, and only to it.

    A full-data commit briefly went through the strip too, because a stored-row test caught
    the block reaching the database that way. That was the wrong fix: the general path must
    never silently rewrite what a caller sent, and a human pasting a rendered file into the
    playground is sending their own text.

    The exposure the strip was covering is closed by the entry point instead. An agent
    CANNOT send a full-data commit: its handler refuses the shape outright
    (`full_data_not_committable`), so the only way the block reaches storage is a human
    deliberately putting it there, which is theirs to do.
    """

    async def test_a_delta_commit_stores_the_text_without_the_block(
        self, engine, variant
    ):
        from oss.src.core.workflows.change_set import (
            PLATFORM_GUIDANCE_END,
            PLATFORM_GUIDANCE_START,
        )

        service = _service(engine)
        block = (
            f"{PLATFORM_GUIDANCE_START}\nCommit with the tool.\n{PLATFORM_GUIDANCE_END}"
        )
        await _commit(
            service,
            variant,
            data={"parameters": {"agent": {"instructions": {"agents_md": "seed"}}}},
        )
        outcome = await _commit(
            service,
            variant,
            delta={
                "set": {
                    "parameters": {
                        "agent": {
                            "instructions": {"agents_md": f"Be concise.\n\n{block}\n"}
                        }
                    }
                }
            },
        )

        stored = await _stored_data(engine, outcome.revision.id)
        agents_md = stored["parameters"]["agent"]["instructions"]["agents_md"]
        assert PLATFORM_GUIDANCE_START not in agents_md
        assert agents_md == "Be concise."

    async def test_a_full_data_commit_stores_exactly_what_it_was_sent(
        self, engine, variant
    ):
        # The general path does not edit caller data, and this is the cell that says so.
        # The agent cannot reach here: its handler refuses a full-data commit by shape.
        from oss.src.core.workflows.change_set import (
            PLATFORM_GUIDANCE_END,
            PLATFORM_GUIDANCE_START,
        )

        service = _service(engine)
        block = (
            f"{PLATFORM_GUIDANCE_START}\nCommit with the tool.\n{PLATFORM_GUIDANCE_END}"
        )
        sent = f"Be concise.\n\n{block}\n"

        outcome = await _commit(
            service,
            variant,
            data={"parameters": {"agent": {"instructions": {"agents_md": sent}}}},
        )

        stored = await _stored_data(engine, outcome.revision.id)
        assert stored["parameters"]["agent"]["instructions"]["agents_md"] == sent
