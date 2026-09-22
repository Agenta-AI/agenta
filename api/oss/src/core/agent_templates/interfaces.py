from typing import Protocol

from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    ResolvedTemplateSource,
    TemplateSourcePin,
)


class TemplateSourceResolver(Protocol):
    async def resolve(
        self,
        *,
        source: InternalTemplateSource,
        pin: TemplateSourcePin | None = None,
    ) -> ResolvedTemplateSource: ...
