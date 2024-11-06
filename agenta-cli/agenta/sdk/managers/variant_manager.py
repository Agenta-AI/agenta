from typing import Optional

from agenta.sdk.managers.shared import SharedManager


class VariantManager(SharedManager):
    @classmethod
    def create_variant(
        cls,
        *,
        app_slug: str,
        variant_slug: str,
        config_parameters: dict,
    ):
        variant = SharedManager().add(
            app_slug=app_slug,
            variant_slug=variant_slug,
        )
        if variant:
            variant = SharedManager().commit(
                app_slug=app_slug,
                variant_slug=variant_slug,
                config_parameters=config_parameters,
            )

        return variant

    @classmethod
    async def acreate_variant(
        cls, *, app_slug: str, variant_slug: str, config_parameters: dict
    ):
        variant = await SharedManager().aadd(
            app_slug=app_slug,
            variant_slug=variant_slug,
        )
        if variant:
            variant = await SharedManager().acommit(
                app_slug=app_slug,
                variant_slug=variant_slug,
                config_parameters=config_parameters,
            )

        return variant

    @classmethod
    def commit_variant(cls, app_slug: str, variant_slug: str, config_parameters: dict):
        variant = SharedManager().commit(
            app_slug=app_slug,
            variant_slug=variant_slug,
            config_parameters=config_parameters,
        )
        return variant

    @classmethod
    async def acommit_variant(
        cls, app_slug: str, variant_slug: str, config_parameters: dict
    ):
        variant = await SharedManager().acommit(
            app_slug=app_slug,
            variant_slug=variant_slug,
            config_parameters=config_parameters,
        )
        return variant

    @classmethod
    def delete_variant(cls, app_slug: str, variant_slug: str):
        message = SharedManager().delete(app_slug=app_slug, variant_slug=variant_slug)
        return message

    @classmethod
    async def adelete_variant(cls, app_slug: str, variant_slug: str):
        message = await SharedManager().adelete(
            app_slug=app_slug, variant_slug=variant_slug
        )
        return message

    @classmethod
    def list_variants(
        cls, app_id: Optional[str] = None, app_slug: Optional[str] = None
    ):
        variants = SharedManager().list(id=app_id, slug=app_slug)
        return variants

    @classmethod
    async def alist_variants(
        cls, app_id: Optional[str] = None, app_slug: Optional[str] = None
    ):
        variants = await SharedManager().alist(id=app_id, slug=app_slug)
        return variants

    @classmethod
    def history_variants(
        cls,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
    ):
        variants = SharedManager().history(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
        )
        return variants

    @classmethod
    async def ahistory_variants(
        cls,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
        variant_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
    ):
        variants = await SharedManager().ahistory(
            app_id=app_id,
            app_slug=app_slug,
            variant_id=variant_id,
            variant_slug=variant_slug,
        )
        return variants
