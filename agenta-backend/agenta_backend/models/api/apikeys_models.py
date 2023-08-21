from pydantic import BaseModel


class SaveOpenAIAPIKey(BaseModel):
    api_key: str


class OpenAIAPIKey(BaseModel):
    user_id: str
    api_key: str
