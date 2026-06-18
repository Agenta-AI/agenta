from typing import Optional

from agenta.sdk.managers.shared import SharedManager


class VariantManager(SharedManager):
    @classmethod
    def create(
        cls,
        *,
        parameters: dict,
        variant_slug: str,
        variant_name: Optional[str] = None,
        revision_name: Optional[str] = None,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variant = SharedManager.add(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
            variant_name=variant_name,
        )

        if variant:
            variant = SharedManager.commit(
                parameters=parameters,
                app_id=app_id,
                app_slug=app_slug,
                variant_slug=variant_slug,
                revision_name=revision_name,
            )

        return variant

    @classmethod
    async def acreate(
        cls,
        *,
        parameters: dict,
        variant_slug: str,
        variant_name: Optional[str] = None,
        revision_name: Optional[str] = None,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variant = await SharedManager.aadd(
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
            variant_name=variant_name,
        )
        if variant:
            variant = await SharedManager.acommit(
                parameters=parameters,
                app_id=app_id,
                app_slug=app_slug,
                variant_slug=variant_slug,
                revision_name=revision_name,
            )

        return variant

    @classmethod
    def commit(
        cls,
        *,
        parameters: dict,
        variant_slug: str,
        revision_name: Optional[str] = None,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variant = SharedManager.commit(
            parameters=parameters,
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
            revision_name=revision_name,
        )
        return variant

    @classmethod
    async def acommit(
        cls,
        *,
        parameters: dict,
        variant_slug: str,
        revision_name: Optional[str] = None,
        #
        app_id: Optional[str] = None,
        app_slug: Optional[str] = None,
    ):
        variant = await SharedManager.acommit(
            parameters=parameters,
            app_id=app_id,
            app_slug=app_slug,
            variant_slug=variant_slug,
            revision_name=revision_name,
        )
        return variant

    @classmethod
    def delete(
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
    async def adelete(
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
    def list(
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
    async def alist(
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
    def history(
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
    async def ahistory(
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
