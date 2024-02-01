from datetime import datetime
from pydantic import BaseModel, Field
from beanie import free_fall_migration


class InvitationDB(BaseModel):
    token: str = Field(unique=True)
    email: str
    expiration_date: datetime = Field(default="0")
    used: bool = False


class Forward:

    @free_fall_migration(document_models=[InvitationDB])
    async def add_fields_to_invitation_db(self, session):
        async for invitation in InvitationDB.find_all():
            invitation.organization_id = "default_org"  # Set default value
            invitation.workspace_id = "default_workspace"  # Set default value
            invitation.workspace_roles = []  # Set empty list
            invitation.created_at = (
                invitation.created_at or datetime.utcnow()
            )  # New field
            await invitation.save()
