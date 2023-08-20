from typing import Dict
from bson import ObjectId
from agenta_backend.services.db_mongo import organization
from agenta_backend.models.api.auth_models import (
    Organization,
    OrganizationUpdate,
)


async def create_new_organization(payload: Organization) -> Dict:
    org = await organization.insert_one(payload.dict())
    return org


async def update_organization(
    org_id: str, payload: OrganizationUpdate
) -> Dict:
    org = await organization.find_one({"_id": ObjectId(org_id)})
    if org is not None:
        values_to_update = {key: value for key, value in payload.dict()}
        updated_org = await organization.update_one(
            {"_id": ObjectId(org_id)}, {"$set": values_to_update}
        )
        return updated_org
    raise NotFound("Organization not found")


class NotFound(Exception):
    """Custom exception for credentials not found"""

    pass
