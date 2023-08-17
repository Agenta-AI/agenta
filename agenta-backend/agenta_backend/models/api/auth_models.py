from pydantic import BaseModel, EmailStr, Optional, Field
from datetime import datetime


class TimestampModel(BaseModel):
    created_at: datetime = Field(datetime.utcnow())
    updated_at: datetime = Field(datetime.utcnow())


class User(TimestampModel):
    id: str
    username: str
    email: EmailStr
    organization_id: int
    
    
class Organization(TimestampModel):
    id: str
    name: str
    description: Optional[str]
    