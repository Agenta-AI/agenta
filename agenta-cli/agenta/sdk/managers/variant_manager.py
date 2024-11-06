from typing import Optional

from agenta.sdk.managers.shared import SharedManager


class VariantManager(SharedManager):
    @classmethod
    def create_variant(
        cls,
        *,
        parameters: dict,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variant = SharedManager.add(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
        )

        if variant:
            variant = SharedManager.commit(
                parameters=parameters,
                app_id=app_id,
                app_slug=app_slug,
                variant_slug=variant_slug,
            )

        return variant

    @classmethod
    async def acreate_variant(
        cls,
        *,
        parameters: dict,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variant = await SharedManager.aadd(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
        )
        if variant:
            variant = await SharedManager.acommit(
                parameters=parameters,
                app_id=app_id,
                app_slug=app_slug,
                variant_slug=variant_slug,
            )

        return variant

    @classmethod
    def commit_variant(
        cls,
        *,
        parameters: dict,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variant = SharedManager.commit(
            parameters=parameters,
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
        )
        return variant

    @classmethod
    async def acommit_variant(
        cls,
        *,
        parameters: dict,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variant = await SharedManager.acommit(
            parameters=parameters,
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
        )
        return variant

    @classmethod
    def delete_variant(
        cls,
        *,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        message = SharedManager.delete(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
        )
        return message

    @classmethod
    async def adelete_variant(
        cls,
        *,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        message = await SharedManager.adelete(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
        )
        return message

    @classmethod
    def list_variants(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variants = SharedManager.list(
            app_id=app_id,
            app_slug=app_slug,
        )
        return variants

    @classmethod
    async def alist_variants(
        cls,
        *,
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variants = await SharedManager.alist(
            app_id=app_id,
            app_slug=app_slug,
        )
        return variants

    @classmethod
    def history_variants(
        cls,
        *,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variants = SharedManager.history(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
        )
        return variants

    @classmethod
    async def ahistory_variants(
        cls,
        *,
        variant_slug: str,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variants = await SharedManager.ahistory(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
        )
        return variants
