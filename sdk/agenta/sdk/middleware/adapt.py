from typing import Callable
from inspect import signature
from uuid import uuid4

from agenta.sdk.utils.logging import get_module_logger

from agenta.sdk.middleware.base import (
    WorkflowMiddleware,
    middleware_as_decorator,
)
from agenta.sdk.workflows.types import (
    WorkflowServiceRequest,
    WorkflowServiceResponse,
    WorkflowServiceData,
    WorkflowRevision,
    Status,
)

log = get_module_logger(__name__)

DEFAULT_INPUTS_MAPPINGS = {
    "request": "request",
    "revision": "revision",
    "parameters": "revision.data.parameters",
    "inputs": "request.data.inputs",
    "outputs": "request.data.traces.0.attributes.ag.data.outputs",
    "trace": "request.data.traces.0",
    "trace_outputs": "request.data.traces.0.attributes.ag.data.outputs",
    "traces": "request.data.traces",
    "traces_outputs": "request.data.traces.{}.attributes.ag.data.outputs",
}

ALLOWED_INPUTS_KEYS = set(DEFAULT_INPUTS_MAPPINGS.keys())

ALLOWED_OUTPUTS_KEYS = {
    "outputs",
    "trace",
}

DEFAULT_MAPPINGS = {}

CURRENT_VERSION = "2025.07.14"


@middleware_as_decorator
class AdaptMiddleware(WorkflowMiddleware):
    def __init__(self):
        pass

    async def __call__(
        self,
        request: WorkflowServiceRequest,
        revision: WorkflowRevision,
        handler: Callable,
    ) -> WorkflowServiceResponse:
        request_data_dict = request.data.model_dump(
            mode="json",
            exclude_none=True,
        )

        revision_data_dict = revision.data.model_dump(
            mode="json",
            exclude_none=True,
        )

        provided_request_keys = sorted(
            {"request", "revision", "parameters"} | set(request_data_dict.keys())
        )

        handler_signature = signature(handler)

        requested_inputs_keys = sorted(set(handler_signature.parameters.keys()))

        kwargs = dict()

        try:
            for requested_input_key in requested_inputs_keys:
                if requested_input_key not in ALLOWED_INPUTS_KEYS:
                    kwargs[requested_input_key] = None
                    continue

                if requested_input_key in provided_request_keys:
                    if requested_input_key == "parameters":
                        kwargs[requested_input_key] = (
                            revision.data.parameters
                            if revision.data.parameters
                            else None
                        )
                    elif requested_input_key == "request":
                        kwargs[requested_input_key] = request
                    elif requested_input_key == "revision":
                        kwargs[requested_input_key] = revision
                    else:
                        kwargs[requested_input_key] = request_data_dict[
                            requested_input_key
                        ]

                else:
                    kwargs[requested_input_key] = self._apply_request_mapping(
                        request=request_data_dict,
                        revision=revision_data_dict,
                        key=requested_input_key,
                    )

        except:  # pylint: disable=bare-except
            # handle the error
            pass

        try:
            # inputs = kwargs.get("inputs", None)

            # inputs_schema =

            # self._check_request_schema(
            #     inputs,
            #     inputs_schema,
            # )

            # parameters = kwargs.get("parameters", None)

            # parameters_schema =

            # self._check_request_schema(
            #     parameters,
            #     parameters_schema,
            # )

            pass

        except:  # pylint: disable=bare-except
            # handle the error
            pass

        try:
            handler_signature.bind(**kwargs)

        except:  # pylint: disable=bare-except
            # handle the error
            pass

        try:
            outputs = await handler(**kwargs)

            trace = None  # get trace

        except:  # pylint: disable=bare-except
            # handle the error
            log.debug()
            raise

        try:
            # outputs_schema =

            # self._check_request_schema(
            #     outputs,
            #     outputs_schema,
            # )

            pass

        except:  # pylint: disable=bare-except
            # handle the error
            pass

        return WorkflowServiceResponse(
            id=uuid4(),
            version=CURRENT_VERSION,
            # status=Status(code=200, message="Success"),
            data=WorkflowServiceData(
                outputs=outputs,
                trace=trace,
            ),
        )

    def _apply_request_mapping(
        self,
        request: dict,
        revision: dict,
        key: str,
    ):
        mapping = DEFAULT_INPUTS_MAPPINGS[key]

        parts = mapping.split(".")

        base_part = parts.pop(0)
        data_part = parts.pop(0)

        base = (
            request
            if base_part == "request" and data_part == "data"
            else (revision if base_part == "revision" and data_part == "data" else {})
        )

        scalar = True
        is_list = False
        is_dict = False

        for part in parts:
            _is_index = part.isdigit()
            _is_list = part == "[]"
            _is_dict = part == "{}"

            _scalar = not (_is_list or _is_dict)

            if not scalar and not _scalar:
                # handle error once we start using mappings
                pass

            if _is_index:
                if isinstance(base, list):
                    base = base[int(part)]
                elif isinstance(base, dict):
                    base = base[list(base.keys())[int(part)]]
                else:
                    # handle error once we start using mappings
                    pass

            elif _is_list:
                if not isinstance(base, list):
                    # handle error once we start using mappings
                    pass
            elif _is_dict:
                if not isinstance(base, dict):
                    # handle error once we start using mappings
                    pass

            else:
                if isinstance(base, dict):
                    if is_list:
                        base = [
                            (item.get(part, None) if isinstance(item, dict) else None)
                            for item in base
                        ]
                    elif is_dict:
                        base = {
                            key: (
                                value.get(part, None)
                                if isinstance(value, dict)
                                else None
                            )
                            for key, value in base.items()
                        }
                    else:
                        base = base.get(part, None)
                else:
                    # handle error once we start using mappings
                    pass

            scalar = _scalar
            is_list = _is_list
            is_dict = _is_dict

        return base
