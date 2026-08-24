from enum import Enum

from pydantic import BaseModel, ConfigDict, model_validator


class SecretManager(str, Enum):
    STARTER_CREDITS_BRIDGE = "starter-credits-bridge"


class SecretManagementPolicy(str, Enum):
    MANAGER_ONLY = "manager_only"


class SecretManagementDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    manager: SecretManager
    policy: SecretManagementPolicy = SecretManagementPolicy.MANAGER_ONLY

    @model_validator(mode="before")
    @classmethod
    def discard_legacy_recommendation(cls, value):
        if isinstance(value, dict) and "recommended_for_new_agents" in value:
            return {
                key: item
                for key, item in value.items()
                if key != "recommended_for_new_agents"
            }
        return value


class PublicSecretManagementDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policy: SecretManagementPolicy


class ManagedSecretReadOnlyError(Exception):
    def __init__(self):
        self.message = (
            "This secret is managed by Agenta and cannot be changed or deleted."
        )
        super().__init__(self.message)
