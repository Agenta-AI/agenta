from pydantic import BaseModel


class SaveAPIKey(BaseModel):
    api_key: str
    

class APIKey(BaseModel):
    user_id: str
    api_key: str
    