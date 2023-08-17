from pydantic import BaseModel, EmailStr, Optional
from datetime import datetime


class TimestampModel(BaseModel):
    created_at: datetime
    updated_at: datetime


class User(TimestampModel):
    id: str
    username: str
    email: EmailStr
    organization_id: int
    
    
class Organization(TimestampModel):
    id: str
    name: str
    description: Optional[str]
    