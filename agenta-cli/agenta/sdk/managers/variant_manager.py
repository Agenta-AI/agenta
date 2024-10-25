from agenta.sdk.managers.shared import SharedManager


class VariantManager(SharedManager):
    def create_variant(
        self,
        *,
        app_slug: str,
        variant_slug: str,
        config_parameters: dict,
    ):
        variant = self.add(
            app_slug=app_slug,
            variant_slug=variant_slug,
        )
        if variant:
            variant = self.commit(
                app_slug=app_slug,
                variant_slug=variant_slug,
                config_parameters=config_parameters,
            )

        return variant

    async def acreate_variant(
        self, *, app_slug: str, variant_slug: str, config_parameters: dict
    ):
        variant = await self.aadd(
            app_slug=app_slug,
            variant_slug=variant_slug,
        )
        if variant:
            variant = await self.acommit_variant(
                app_slug=app_slug,
                variant_slug=variant_slug,
                config_parameters=config_parameters,
            )

        return variant

    def commit_variant(self, app_slug: str, variant_slug: str, config_parameters: dict):
        variant = self.commit(
            app_slug=app_slug,
            variant_slug=variant_slug,
            config_parameters=config_parameters,
        )
        return variant

    async def acommit_variant(
        self, app_slug: str, variant_slug: str, config_parameters: dict
    ):
        variant = await self.acommit(
            app_slug=app_slug,
            variant_slug=variant_slug,
            config_parameters=config_parameters,
        )
        return variant

    def delete_variant(self):
        ...

    def adelete_variant(self):
        ...

    def list_variants(self):
        ...

    def alist_variants(self):
        ...
