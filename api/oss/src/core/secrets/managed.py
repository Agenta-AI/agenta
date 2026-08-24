from enum import Enum

from pydantic import BaseModel, ConfigDict


class SecretManager(str, Enum):
    STARTER_CREDITS_BRIDGE = "starter-credits-bridge"


class SecretManagementPolicy(str, Enum):
    MANAGER_ONLY = "manager_only"


class SecretManagementDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    manager: SecretManager
    policy: SecretManagementPolicy = SecretManagementPolicy.MANAGER_ONLY
    recommended_for_new_agents: bool = False


class PublicSecretManagementDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policy: SecretManagementPolicy
    recommended_for_new_agents: bool = False


class ManagedSecretReadOnlyError(Exception):
    def __init__(self):
        self.message = (
            "This secret is managed by Agenta and cannot be changed or deleted."
        )
        super().__init__(self.message)
