from typing import Optional

from agenta.sdk.managers.shared import SharedManager


class DeploymentManager(SharedManager):
    @classmethod
    def deploy_variant(
        cls,
        *,
        app_slug: str,
        variant_slug: str,
        environment_slug: str,
        variant_version: Optional[int]
    ):
        deployment = cls.deploy(
            app_slug=app_slug,
            variant_slug=variant_slug,
            environment_slug=environment_slug,
            variant_version=variant_version,
        )
        return deployment

    @classmethod
    async def adeploy_variant(
        cls,
        *,
        app_slug: str,
        variant_slug: str,
        environment_slug: str,
        variant_version: Optional[int]
    ):
        deployment = await cls.adeploy(
            app_slug=app_slug,
            variant_slug=variant_slug,
            environment_slug=environment_slug,
            variant_version=variant_version,
        )
        return deployment
