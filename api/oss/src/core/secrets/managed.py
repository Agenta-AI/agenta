from enum import Enum

from pydantic import BaseModel, ConfigDict


class SecretManager(str, Enum):
    # The retired starter-credits program. Nothing writes new rows with it, but stored
    # rows may still carry it, so it must stay readable.
    STARTER_CREDITS_BRIDGE = "starter-credits-bridge"


class SecretManagementPolicy(str, Enum):
    MANAGER_ONLY = "manager_only"


class SecretManagementDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    manager: SecretManager
    policy: SecretManagementPolicy = SecretManagementPolicy.MANAGER_ONLY


class PublicSecretManagementDTO(BaseModel):
    model_config = ConfigDict(extra="forbid")

    policy: SecretManagementPolicy


class ManagedSecretReadOnlyError(Exception):
    def __init__(self):
        self.message = (
            "This secret is managed by Agenta and cannot be changed or deleted."
        )
        super().__init__(self.message)
