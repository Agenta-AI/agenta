"""The explicit catalog of managed actions and the providers that serve them."""

from typing import Dict, List, Sequence

from oss.src.core.managed_tools.dtos import ManagedAction
from oss.src.core.managed_tools.interfaces import ManagedActionProviderInterface
from oss.src.core.managed_tools.types import (
    ManagedActionNotFoundError,
    ManagedActionRegistryError,
)


class ManagedActionRegistry:
    def __init__(
        self,
        *,
        actions: Sequence[ManagedAction],
        providers: Sequence[ManagedActionProviderInterface],
    ) -> None:
        self._providers: Dict[str, ManagedActionProviderInterface] = {}
        for provider in providers:
            if provider.name in self._providers:
                raise ManagedActionRegistryError(
                    f"duplicate provider {provider.name!r}"
                )
            self._providers[provider.name] = provider

        self._actions: Dict[str, ManagedAction] = {}
        keys = set()
        for action in actions:
            if action.binding.provider not in self._providers:
                raise ManagedActionRegistryError(
                    f"{action.key} is bound to unregistered provider "
                    f"{action.binding.provider!r}"
                )
            if action.key in keys or action.tool in self._actions:
                raise ManagedActionRegistryError(f"duplicate action {action.key!r}")
            keys.add(action.key)
            self._actions[action.tool] = action

    def get_by_tool(self, tool: str) -> ManagedAction:
        action = self._actions.get(tool)
        if action is None:
            raise ManagedActionNotFoundError(tool=tool)
        return action

    def provider_for(self, action: ManagedAction) -> ManagedActionProviderInterface:
        return self._providers[action.binding.provider]

    def list(self) -> List[ManagedAction]:
        return list(self._actions.values())
