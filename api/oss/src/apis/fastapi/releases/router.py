from fastapi import APIRouter, status

from oss.src.apis.fastapi.releases.models import InstanceReleasesResponse
from oss.src.core.releases.service import ReleasesService
from oss.src.utils.exceptions import intercept_exceptions


class ReleasesRouter:
    def __init__(
        self,
        *,
        releases_service: ReleasesService,
    ):
        self.service = releases_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/releases",
            self.fetch_instance_releases,
            methods=["GET"],
            operation_id="fetch_instance_releases",
            status_code=status.HTTP_200_OK,
            response_model=InstanceReleasesResponse,
        )

    @intercept_exceptions()
    async def fetch_instance_releases(self) -> InstanceReleasesResponse:
        releases = await self.service.fetch_instance_releases()
        return InstanceReleasesResponse(**releases.model_dump())
