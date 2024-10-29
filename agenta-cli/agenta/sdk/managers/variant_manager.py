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
        variant = cls.add(
            app_slug=app_slug,
            variant_slug=variant_slug,
        )
        if variant:
            variant = cls.commit(
                app_slug=app_slug,
                variant_slug=variant_slug,
                config_parameters=config_parameters,
            )

        return variant

    @classmethod
    async def acreate_variant(
        cls, *, app_slug: str, variant_slug: str, config_parameters: dict
    ):
        variant = await cls.aadd(
            app_slug=app_slug,
            variant_slug=variant_slug,
        )
        if variant:
            variant = await cls.acommit_variant(
                app_slug=app_slug,
                variant_slug=variant_slug,
                config_parameters=config_parameters,
            )

        return variant

    @classmethod
    def commit_variant(cls, app_slug: str, variant_slug: str, config_parameters: dict):
        variant = cls.commit(
            app_slug=app_slug,
            variant_slug=variant_slug,
            config_parameters=config_parameters,
        )
        return variant

    @classmethod
    async def acommit_variant(
        cls, app_slug: str, variant_slug: str, config_parameters: dict
    ):
        variant = await cls.acommit(
            app_slug=app_slug,
            variant_slug=variant_slug,
            config_parameters=config_parameters,
        )
        return variant

    @classmethod
    def delete_variant(cls, app_slug: str, variant_slug: str):
        message = cls.delete(app_slug=app_slug, variant_slug=variant_slug)
        return message

    @classmethod
    async def adelete_variant(cls, app_slug: str, variant_slug: str):
        message = await cls.adelete(app_slug=app_slug, variant_slug=variant_slug)
        return message

    @classmethod
    def list_variants(cls, app_slug: str):
        variants = cls.list(app_slug=app_slug)
        return variants

    @classmethod
    async def alist_variants(cls, app_slug: str):
        variants = await cls.alist(app_slug=app_slug)
        return variants
