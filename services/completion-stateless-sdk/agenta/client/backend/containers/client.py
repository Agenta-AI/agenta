# This file was auto-generated by Fern from our API Definition.

import typing
from ..core.client_wrapper import SyncClientWrapper
from .. import core
from ..core.request_options import RequestOptions
from ..types.image import Image
from ..core.pydantic_utilities import parse_obj_as
from ..errors.unprocessable_entity_error import UnprocessableEntityError
from ..types.http_validation_error import HttpValidationError
from json.decoder import JSONDecodeError
from ..core.api_error import ApiError
from .types.container_templates_response import ContainerTemplatesResponse
from ..types.uri import Uri
from ..core.client_wrapper import AsyncClientWrapper

# this is used as the default value for optional parameters
OMIT = typing.cast(typing.Any, ...)


class ContainersClient:
    def __init__(self, *, client_wrapper: SyncClientWrapper):
        self._client_wrapper = client_wrapper

    def build_image(
        self,
        *,
        app_id: str,
        base_name: str,
        tar_file: core.File,
        request_options: typing.Optional[RequestOptions] = None,
    ) -> Image:
        """
        Builds a Docker image from a tar file containing the application code.

        Args:
        app_id (str): The ID of the application to build the image for.
        base_name (str): The base name of the image to build.
        tar_file (UploadFile): The tar file containing the application code.
        stoken_session (SessionContainer): The session container for the user making the request.

        Returns:
        Image: The Docker image that was built.

        Parameters
        ----------
        app_id : str

        base_name : str

        tar_file : core.File
            See core.File for more documentation

        request_options : typing.Optional[RequestOptions]
            Request-specific configuration.

        Returns
        -------
        Image
            Successful Response

        Examples
        --------
        from agenta import AgentaApi

        client = AgentaApi(
            api_key="YOUR_API_KEY",
            base_url="https://yourhost.com/path/to/api",
        )
        client.containers.build_image(
            app_id="app_id",
            base_name="base_name",
        )
        """
        _response = self._client_wrapper.httpx_client.request(
            "containers/build_image",
            method="POST",
            params={
                "app_id": app_id,
                "base_name": base_name,
            },
            data={},
            files={
                "tar_file": tar_file,
            },
            request_options=(
                {**request_options, "timeout_in_seconds": 600}
                if request_options
                else {"timeout_in_seconds": 600}
            ),
            omit=OMIT,
        )
        try:
            if 200 <= _response.status_code < 300:
                return typing.cast(
                    Image,
                    parse_obj_as(
                        type_=Image,  # type: ignore
                        object_=_response.json(),
                    ),
                )
            if _response.status_code == 422:
                raise UnprocessableEntityError(
                    typing.cast(
                        HttpValidationError,
                        parse_obj_as(
                            type_=HttpValidationError,  # type: ignore
                            object_=_response.json(),
                        ),
                    )
                )
            _response_json = _response.json()
        except JSONDecodeError:
            raise ApiError(status_code=_response.status_code, body=_response.text)
        raise ApiError(status_code=_response.status_code, body=_response_json)

    def restart_container(
        self,
        *,
        variant_id: str,
        request_options: typing.Optional[RequestOptions] = None,
    ) -> typing.Dict[str, typing.Optional[typing.Any]]:
        """
        Restart docker container.

        Args:
        payload (RestartAppContainer) -- the required data (app_name and variant_name)

        Parameters
        ----------
        variant_id : str

        request_options : typing.Optional[RequestOptions]
            Request-specific configuration.

        Returns
        -------
        typing.Dict[str, typing.Optional[typing.Any]]
            Successful Response

        Examples
        --------
        from agenta import AgentaApi

        client = AgentaApi(
            api_key="YOUR_API_KEY",
            base_url="https://yourhost.com/path/to/api",
        )
        client.containers.restart_container(
            variant_id="variant_id",
        )
        """
        _response = self._client_wrapper.httpx_client.request(
            "containers/restart_container",
            method="POST",
            json={
                "variant_id": variant_id,
            },
            request_options=request_options,
            omit=OMIT,
        )
        try:
            if 200 <= _response.status_code < 300:
                return typing.cast(
                    typing.Dict[str, typing.Optional[typing.Any]],
                    parse_obj_as(
                        type_=typing.Dict[str, typing.Optional[typing.Any]],  # type: ignore
                        object_=_response.json(),
                    ),
                )
            if _response.status_code == 422:
                raise UnprocessableEntityError(
                    typing.cast(
                        HttpValidationError,
                        parse_obj_as(
                            type_=HttpValidationError,  # type: ignore
                            object_=_response.json(),
                        ),
                    )
                )
            _response_json = _response.json()
        except JSONDecodeError:
            raise ApiError(status_code=_response.status_code, body=_response.text)
        raise ApiError(status_code=_response.status_code, body=_response_json)

    def container_templates(
        self, *, request_options: typing.Optional[RequestOptions] = None
    ) -> ContainerTemplatesResponse:
        """
        Returns a list of templates available for creating new containers.

        Parameters:
        stoken_session (SessionContainer): The session container for the user.

        Returns:

        Union[List[Template], str]: A list of templates or an error message.

        Parameters
        ----------
        request_options : typing.Optional[RequestOptions]
            Request-specific configuration.

        Returns
        -------
        ContainerTemplatesResponse
            Successful Response

        Examples
        --------
        from agenta import AgentaApi

        client = AgentaApi(
            api_key="YOUR_API_KEY",
            base_url="https://yourhost.com/path/to/api",
        )
        client.containers.container_templates()
        """
        _response = self._client_wrapper.httpx_client.request(
            "containers/templates",
            method="GET",
            request_options=request_options,
        )
        try:
            if 200 <= _response.status_code < 300:
                return typing.cast(
                    ContainerTemplatesResponse,
                    parse_obj_as(
                        type_=ContainerTemplatesResponse,  # type: ignore
                        object_=_response.json(),
                    ),
                )
            _response_json = _response.json()
        except JSONDecodeError:
            raise ApiError(status_code=_response.status_code, body=_response.text)
        raise ApiError(status_code=_response.status_code, body=_response_json)

    def construct_app_container_url(
        self,
        *,
        base_id: typing.Optional[str] = None,
        variant_id: typing.Optional[str] = None,
        request_options: typing.Optional[RequestOptions] = None,
    ) -> Uri:
        """
        Constructs the URL for an app container based on the provided base_id or variant_id.

        Args:
        base_id (Optional[str]): The ID of the base to use for the app container.
        variant_id (Optional[str]): The ID of the variant to use for the app container.
        request (Request): The request object.

        Returns:
        URI: The URI for the app container.

        Raises:
        HTTPException: If the base or variant cannot be found or the user does not have access.

        Parameters
        ----------
        base_id : typing.Optional[str]

        variant_id : typing.Optional[str]

        request_options : typing.Optional[RequestOptions]
            Request-specific configuration.

        Returns
        -------
        Uri
            Successful Response

        Examples
        --------
        from agenta import AgentaApi

        client = AgentaApi(
            api_key="YOUR_API_KEY",
            base_url="https://yourhost.com/path/to/api",
        )
        client.containers.construct_app_container_url()
        """
        _response = self._client_wrapper.httpx_client.request(
            "containers/container_url",
            method="GET",
            params={
                "base_id": base_id,
                "variant_id": variant_id,
            },
            request_options=request_options,
        )
        try:
            if 200 <= _response.status_code < 300:
                return typing.cast(
                    Uri,
                    parse_obj_as(
                        type_=Uri,  # type: ignore
                        object_=_response.json(),
                    ),
                )
            if _response.status_code == 422:
                raise UnprocessableEntityError(
                    typing.cast(
                        HttpValidationError,
                        parse_obj_as(
                            type_=HttpValidationError,  # type: ignore
                            object_=_response.json(),
                        ),
                    )
                )
            _response_json = _response.json()
        except JSONDecodeError:
            raise ApiError(status_code=_response.status_code, body=_response.text)
        raise ApiError(status_code=_response.status_code, body=_response_json)


class AsyncContainersClient:
    def __init__(self, *, client_wrapper: AsyncClientWrapper):
        self._client_wrapper = client_wrapper

    async def build_image(
        self,
        *,
        app_id: str,
        base_name: str,
        tar_file: core.File,
        request_options: typing.Optional[RequestOptions] = None,
    ) -> Image:
        """
        Builds a Docker image from a tar file containing the application code.

        Args:
        app_id (str): The ID of the application to build the image for.
        base_name (str): The base name of the image to build.
        tar_file (UploadFile): The tar file containing the application code.
        stoken_session (SessionContainer): The session container for the user making the request.

        Returns:
        Image: The Docker image that was built.

        Parameters
        ----------
        app_id : str

        base_name : str

        tar_file : core.File
            See core.File for more documentation

        request_options : typing.Optional[RequestOptions]
            Request-specific configuration.

        Returns
        -------
        Image
            Successful Response

        Examples
        --------
        import asyncio

        from agenta import AsyncAgentaApi

        client = AsyncAgentaApi(
            api_key="YOUR_API_KEY",
            base_url="https://yourhost.com/path/to/api",
        )


        async def main() -> None:
            await client.containers.build_image(
                app_id="app_id",
                base_name="base_name",
            )


        asyncio.run(main())
        """
        _response = await self._client_wrapper.httpx_client.request(
            "containers/build_image",
            method="POST",
            params={
                "app_id": app_id,
                "base_name": base_name,
            },
            data={},
            files={
                "tar_file": tar_file,
            },
            request_options=(
                {**request_options, "timeout_in_seconds": 600}
                if request_options
                else {"timeout_in_seconds": 600}
            ),
            omit=OMIT,
        )
        try:
            if 200 <= _response.status_code < 300:
                return typing.cast(
                    Image,
                    parse_obj_as(
                        type_=Image,  # type: ignore
                        object_=_response.json(),
                    ),
                )
            if _response.status_code == 422:
                raise UnprocessableEntityError(
                    typing.cast(
                        HttpValidationError,
                        parse_obj_as(
                            type_=HttpValidationError,  # type: ignore
                            object_=_response.json(),
                        ),
                    )
                )
            _response_json = _response.json()
        except JSONDecodeError:
            raise ApiError(status_code=_response.status_code, body=_response.text)
        raise ApiError(status_code=_response.status_code, body=_response_json)

    async def restart_container(
        self,
        *,
        variant_id: str,
        request_options: typing.Optional[RequestOptions] = None,
    ) -> typing.Dict[str, typing.Optional[typing.Any]]:
        """
        Restart docker container.

        Args:
        payload (RestartAppContainer) -- the required data (app_name and variant_name)

        Parameters
        ----------
        variant_id : str

        request_options : typing.Optional[RequestOptions]
            Request-specific configuration.

        Returns
        -------
        typing.Dict[str, typing.Optional[typing.Any]]
            Successful Response

        Examples
        --------
        import asyncio

        from agenta import AsyncAgentaApi

        client = AsyncAgentaApi(
            api_key="YOUR_API_KEY",
            base_url="https://yourhost.com/path/to/api",
        )


        async def main() -> None:
            await client.containers.restart_container(
                variant_id="variant_id",
            )


        asyncio.run(main())
        """
        _response = await self._client_wrapper.httpx_client.request(
            "containers/restart_container",
            method="POST",
            json={
                "variant_id": variant_id,
            },
            request_options=request_options,
            omit=OMIT,
        )
        try:
            if 200 <= _response.status_code < 300:
                return typing.cast(
                    typing.Dict[str, typing.Optional[typing.Any]],
                    parse_obj_as(
                        type_=typing.Dict[str, typing.Optional[typing.Any]],  # type: ignore
                        object_=_response.json(),
                    ),
                )
            if _response.status_code == 422:
                raise UnprocessableEntityError(
                    typing.cast(
                        HttpValidationError,
                        parse_obj_as(
                            type_=HttpValidationError,  # type: ignore
                            object_=_response.json(),
                        ),
                    )
                )
            _response_json = _response.json()
        except JSONDecodeError:
            raise ApiError(status_code=_response.status_code, body=_response.text)
        raise ApiError(status_code=_response.status_code, body=_response_json)

    async def container_templates(
        self, *, request_options: typing.Optional[RequestOptions] = None
    ) -> ContainerTemplatesResponse:
        """
        Returns a list of templates available for creating new containers.

        Parameters:
        stoken_session (SessionContainer): The session container for the user.

        Returns:

        Union[List[Template], str]: A list of templates or an error message.

        Parameters
        ----------
        request_options : typing.Optional[RequestOptions]
            Request-specific configuration.

        Returns
        -------
        ContainerTemplatesResponse
            Successful Response

        Examples
        --------
        import asyncio

        from agenta import AsyncAgentaApi

        client = AsyncAgentaApi(
            api_key="YOUR_API_KEY",
            base_url="https://yourhost.com/path/to/api",
        )


        async def main() -> None:
            await client.containers.container_templates()


        asyncio.run(main())
        """
        _response = await self._client_wrapper.httpx_client.request(
            "containers/templates",
            method="GET",
            request_options=request_options,
        )
        try:
            if 200 <= _response.status_code < 300:
                return typing.cast(
                    ContainerTemplatesResponse,
                    parse_obj_as(
                        type_=ContainerTemplatesResponse,  # type: ignore
                        object_=_response.json(),
                    ),
                )
            _response_json = _response.json()
        except JSONDecodeError:
            raise ApiError(status_code=_response.status_code, body=_response.text)
        raise ApiError(status_code=_response.status_code, body=_response_json)

    async def construct_app_container_url(
        self,
        *,
        base_id: typing.Optional[str] = None,
        variant_id: typing.Optional[str] = None,
        request_options: typing.Optional[RequestOptions] = None,
    ) -> Uri:
        """
        Constructs the URL for an app container based on the provided base_id or variant_id.

        Args:
        base_id (Optional[str]): The ID of the base to use for the app container.
        variant_id (Optional[str]): The ID of the variant to use for the app container.
        request (Request): The request object.

        Returns:
        URI: The URI for the app container.

        Raises:
        HTTPException: If the base or variant cannot be found or the user does not have access.

        Parameters
        ----------
        base_id : typing.Optional[str]

        variant_id : typing.Optional[str]

        request_options : typing.Optional[RequestOptions]
            Request-specific configuration.

        Returns
        -------
        Uri
            Successful Response

        Examples
        --------
        import asyncio

        from agenta import AsyncAgentaApi

        client = AsyncAgentaApi(
            api_key="YOUR_API_KEY",
            base_url="https://yourhost.com/path/to/api",
        )


        async def main() -> None:
            await client.containers.construct_app_container_url()


        asyncio.run(main())
        """
        _response = await self._client_wrapper.httpx_client.request(
            "containers/container_url",
            method="GET",
            params={
                "base_id": base_id,
                "variant_id": variant_id,
            },
            request_options=request_options,
        )
        try:
            if 200 <= _response.status_code < 300:
                return typing.cast(
                    Uri,
                    parse_obj_as(
                        type_=Uri,  # type: ignore
                        object_=_response.json(),
                    ),
                )
            if _response.status_code == 422:
                raise UnprocessableEntityError(
                    typing.cast(
                        HttpValidationError,
                        parse_obj_as(
                            type_=HttpValidationError,  # type: ignore
                            object_=_response.json(),
                        ),
                    )
                )
            _response_json = _response.json()
        except JSONDecodeError:
            raise ApiError(status_code=_response.status_code, body=_response.text)
        raise ApiError(status_code=_response.status_code, body=_response_json)