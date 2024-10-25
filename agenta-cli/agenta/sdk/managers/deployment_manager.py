from typing import Optional

from agenta.sdk.managers.shared import SharedManager


class DeploymentManager(SharedManager):
    def deploy_variant(
        self,
        *,
        app_slug: str,
        variant_slug: str,
        environment_slug: str,
        variant_version: Optional[int]
    ):
        deployment = self.deploy(
            app_slug=app_slug,
            variant_slug=variant_slug,
            environment_slug=environment_slug,
            variant_version=variant_version,
        )
        return deployment

    async def adeploy_variant(
        self,
        *,
        app_slug: str,
        variant_slug: str,
        environment_slug: str,
        variant_version: Optional[int]
    ):
        deployment = await self.adeploy(
            app_slug=app_slug,
            variant_slug=variant_slug,
            environment_slug=environment_slug,
            variant_version=variant_version,
        )
        return deployment
