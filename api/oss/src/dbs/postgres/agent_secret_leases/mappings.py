from oss.src.core.agent_secret_leases.dtos import AgentSecretLease, LeaseResource
from oss.src.dbs.postgres.agent_secret_leases.dbes import (
    AgentSecretLeaseDBE,
    AgentSecretLeaseResourceDBE,
)


def resource_dbe_to_dto(dbe: AgentSecretLeaseResourceDBE) -> LeaseResource:
    return LeaseResource.model_validate(
        {
            column.name: getattr(dbe, column.name)
            for column in dbe.__table__.columns
            if column.name != "provider"
        }
    )


def lease_dbe_to_dto(dbe: AgentSecretLeaseDBE) -> AgentSecretLease:
    values = {
        column.name: getattr(dbe, column.name) for column in dbe.__table__.columns
    }
    values["resources"] = [
        resource_dbe_to_dto(item)
        for item in sorted(dbe.resources, key=lambda item: item.ordinal)
    ]
    return AgentSecretLease.model_validate(values)
