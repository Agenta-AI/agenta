from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field

from beanie import Document, PydanticObjectId, free_fall_migration


class InvitationDB(BaseModel):
    token: str = Field(unique=True)
    email: str
    expiration_date: datetime = Field(default="0")
    used: bool = False


class OldOrganizationDB(Document):
    name: str = Field(default="agenta")
    description: str = Field(default="")
    type: Optional[str]
    owner: str  # user id
    members: Optional[List[PydanticObjectId]]
    invitations: Optional[List[InvitationDB]] = []
    created_at: Optional[datetime] = Field(default=datetime.utcnow())
    updated_at: Optional[datetime] = Field(default=datetime.utcnow())

    class Settings:
        name = "organizations"


class Forward:
    @free_fall_migration(document_models=[OldOrganizationDB])
    async def drop_old_organization_db(self, session):
        # Wrap deletion loop in a with_transaction context for potential rollback
        async with session.start_transaction():
            async for old_organization in OldOrganizationDB.find_all():
                await old_organization.delete()

        # Commit the transaction if everything succeeds
        await session.commit()


class Backward:
    pass
