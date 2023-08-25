from datetime import datetime
from typing import Optional, Dict, Any
from odmantic import Field, Model, EmbeddedModel, Reference


class OrganizationDB(EmbeddedModel):
    name: str
    description: str
    
    class Config:
        collection = "organizations"
        

class UserDB(EmbeddedModel):
    uid: str = Field(default=0, unique=True, index=True)
    username: str
    email: str = Field(unique=True)
    organization_id: OrganizationDB

    class Config:
        collection = "users"
        

class ImageDB(Model):
    """Defines the info needed to get an image and connect it to the app variant"""
    
    id: Optional[str] = Field(primary_field=True)
    docker_id: str = Field(index=True)
    tags: str
    user_id: UserDB = Reference(key_name="user")
    created_at: datetime = Field(default=datetime.utcnow())
    updated_at: datetime = Field(default=datetime.utcnow())
    
    class Config:
        collection = "images"
    

class AppVariantDB(Model):
    app_name: str
    variant_name: str
    image_id: ImageDB = Reference()
    user_id: UserDB = Reference(key_name="user")
    parameters: Dict[str, Any]
    previous_variant_name: Optional[str]
    is_deleted: bool = Field(
        default=False
    )  # soft deletion for using the template variants

    class Config:
        collection = "app_variants"
        
        

class TemplateDB(Model):
    template_id: int
    name: str
    repo_name: str
    architecture: str
    title: str
    description: str
    size: int
    digest: str
    status: str
    media_type: str
    last_pushed: datetime
    
    class Config:
        collection = "templates"
