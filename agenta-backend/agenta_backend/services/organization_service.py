from bson import ObjectId
from agenta_backend.services.db_manager import engine, OrganizationDB
from agenta_backend.models.api.organization_models import (
    Organization,
    OrganizationUpdate,
)


async def get_organization(org_id: str) -> OrganizationDB:
    org = await engine.find_one(OrganizationDB, OrganizationDB.id == ObjectId(org_id))
    return org


async def create_new_organization(payload: Organization) -> OrganizationDB:
    org_instance = OrganizationDB(**payload.dict())
    org = await engine.save(org_instance)
    return org


async def update_organization(
    org_id: str, payload: OrganizationUpdate
) -> OrganizationDB:
    org = await engine.find_one(OrganizationDB, OrganizationDB.id == ObjectId(org_id))
    if org is not None:
        values_to_update = {key: value for key, value in payload.dict()}
        updated_org = org.update(values_to_update)
        await engine.save(updated_org)
        return org
    raise NotFound("Organization not found")


class NotFound(Exception):
    """Custom exception for credentials not found"""

    pass
