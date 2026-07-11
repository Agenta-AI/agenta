from pathlib import Path

import oss.src.models.db_models  # noqa: F401

from sqlalchemy.schema import CreateIndex, CreateTable
from sqlalchemy.dialects import postgresql

from oss.src.dbs.postgres.agent_secret_leases.dbes import (
    AgentSecretLeaseDBE,
    AgentSecretLeaseResourceDBE,
)


def test_normalized_tables_never_define_plaintext_or_source_reference_columns():
    forbidden = {
        "value",
        "plaintext",
        "vault_id",
        "vault_slug",
        "placeholder",
        "endpoint",
        "authorization",
        "raw_error",
    }
    columns = {
        column.name
        for table in (
            AgentSecretLeaseDBE.__table__,
            AgentSecretLeaseResourceDBE.__table__,
        )
        for column in table.columns
    }
    assert forbidden.isdisjoint(columns)
    assert {"provider_secret_name", "provider_secret_id", "allowed_host"} <= columns


def test_claim_retry_owner_and_global_uniqueness_indexes_exist():
    indexes = {
        index.name
        for table in (
            AgentSecretLeaseDBE.__table__,
            AgentSecretLeaseResourceDBE.__table__,
        )
        for index in table.indexes
    }
    assert {
        "ix_agent_secret_leases_provider_retry",
        "ix_agent_secret_leases_org_retry",
        "ix_agent_secret_leases_owner",
        "uq_agent_secret_leases_provider_sandbox",
        "uq_agent_secret_lease_resources_binding",
    } <= indexes
    binding = next(
        index
        for index in AgentSecretLeaseResourceDBE.__table__.indexes
        if index.name == "uq_agent_secret_lease_resources_binding"
    )
    sql = str(CreateIndex(binding).compile(dialect=postgresql.dialect()))
    assert "coalesce" in sql.lower() and "unique" in sql.lower()
    for name in (
        "ix_agent_secret_leases_provider_retry",
        "ix_agent_secret_leases_org_retry",
    ):
        retry = next(
            index
            for index in AgentSecretLeaseDBE.__table__.indexes
            if index.name == name
        )
        retry_sql = str(CreateIndex(retry).compile(dialect=postgresql.dialect()))
        assert "created_at" in retry_sql.lower()
        assert "next_attempt_at" not in retry_sql.lower()


def test_database_enforces_bounded_errors_and_resource_consistency():
    constraint_names = {
        constraint.name
        for table in (
            AgentSecretLeaseDBE.__table__,
            AgentSecretLeaseResourceDBE.__table__,
        )
        for constraint in table.constraints
    }
    assert {
        "ck_agent_secret_leases_safe_error_code",
        "ck_agent_secret_leases_claim_consistency",
        "ck_agent_secret_lease_resources_consumer_key",
        "ck_agent_secret_lease_resources_created_id",
    } <= constraint_names


def test_claim_columns_are_all_null_or_form_a_positive_generation_fence():
    ddl = str(
        CreateTable(AgentSecretLeaseDBE.__table__).compile(dialect=postgresql.dialect())
    ).lower()
    constraint = ddl.split(
        "constraint ck_agent_secret_leases_claim_consistency", maxsplit=1
    )[1]
    constraint = constraint.split("constraint", maxsplit=1)[0]
    assert "claim_id is null" in constraint
    assert "claim_owner is null" in constraint
    assert "claim_expires_at is null" in constraint
    assert "claim_id is not null" in constraint
    assert "claim_owner is not null" in constraint
    assert "claim_expires_at is not null" in constraint
    assert "claim_generation > 0" in constraint


def test_migration_matches_runtime_cursor_indexes_and_claim_constraint():
    migration = (
        Path(__file__).resolve().parents[4]
        / "databases/postgres/migrations/core_oss/versions/"
        "oss000000011_add_agent_secret_leases.py"
    ).read_text()
    assert "ck_agent_secret_leases_claim_consistency" in migration
    assert "(provider, state, created_at, id)" in migration
    assert "(organization_id, state, created_at, id)" in migration
    assert "COALESCE(next_attempt_at, created_at)" not in migration
