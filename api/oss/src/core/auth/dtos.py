from typing import Dict, List

from pydantic import BaseModel


class SSOProviderInfo(BaseModel):
    id: str
    slug: str
    third_party_id: str


class SSOProviders(BaseModel):
    providers: List[SSOProviderInfo]


class DiscoverResponse(BaseModel):
    exists: bool
    methods: Dict[str, bool | SSOProviders]
