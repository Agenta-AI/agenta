from typing import Optional

from agenta.sdk.managers.shared import SharedManager


class DeploymentManager:
    @classmethod
    def deploy(
        cls,
        *,
        variant_slug: str,
        environment_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
    ):
        deployment = SharedManager.deploy(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_slug=environment_slug,
        )
        return deployment

    @classmethod
    async def adeploy(
        cls,
        *,
        variant_slug: str,
        environment_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
    ):
        deployment = await SharedManager.adeploy(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
            variant_version=variant_version,
            environment_slug=environment_slug,
        )
        return deployment
