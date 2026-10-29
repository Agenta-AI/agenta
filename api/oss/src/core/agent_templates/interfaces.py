from contextlib import AbstractAsyncContextManager
from typing import Protocol
from uuid import UUID

from oss.src.core.agent_templates.archive import PackageTreeWriter
from oss.src.core.agent_templates.dtos import (
    ResolvedTemplateSource,
    TemplateSource,
    TemplateSourcePin,
)


class TemplateSourceResolver(Protocol):
    """Open one package source as a readable directory for the parser.

    The directory is valid only inside the context. Staged sources delete their
    temporary copy on exit, so callers parse before leaving it.
    """

    def open(
        self,
        *,
        project_id: UUID,
        source: TemplateSource,
        pin: TemplateSourcePin | None = None,
    ) -> AbstractAsyncContextManager[ResolvedTemplateSource]: ...


class TemplatePackageStager(Protocol):
    """Write one authorized source's package files through the bounded writer.

    An adapter owns authorization and transport for its source kind. The writer
    owns every path and size rule, so each adapter gets the same limits.
    """

    async def stage(
        self,
        *,
        project_id: UUID,
        source: TemplateSource,
        writer: PackageTreeWriter,
    ) -> None: ...
