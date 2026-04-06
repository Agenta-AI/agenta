from typing import Any, Dict, List, Optional
from opentelemetry.trace import SpanKind

import agenta as ag

from agenta.sdk.tracing.spans import CustomSpan
from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)


def _extract_message_dict(message: Any) -> Dict[str, Any]:
    """Extract a message dict from a LiteLLM Message object.

    In newer LiteLLM versions, Anthropic extended-thinking responses split
    the content: ``message.content`` holds only the final text while
    ``message.thinking_blocks`` holds the reasoning blocks separately.
    This function reconstructs a unified content list so that thinking
    blocks are preserved in the trace.
    """
    msg_dict: Dict[str, Any] = {
        k: v for k, v in message.__dict__.items() if not k.startswith("_")
    }

    thinking_blocks: Optional[List[Any]] = getattr(message, "thinking_blocks", None)
    if not thinking_blocks:
        return msg_dict

    full_content: List[Dict[str, Any]] = []

    for block in thinking_blocks:
        if isinstance(block, dict):
            thinking_text = block.get("thinking")
            if thinking_text is not None:
                full_content.append(
                    {"type": "thinking", "thinking": str(thinking_text)}
                )
        elif hasattr(block, "thinking") and block.thinking is not None:
            full_content.append({"type": "thinking", "thinking": str(block.thinking)})

    text_content = msg_dict.get("content")
    if isinstance(text_content, str) and text_content:
        full_content.append({"type": "text", "text": text_content})
    elif isinstance(text_content, list):
        full_content.extend(text_content)

    if full_content:
        msg_dict["content"] = full_content

    return msg_dict


def litellm_handler():
    try:
        from litellm.integrations.custom_logger import (  # pylint: disable=import-outside-toplevel
            CustomLogger as LitellmCustomLogger,
        )
    except ImportError as exc:
        raise ImportError(
            "The litellm SDK is not installed. Please install it using `pip install litellm`."
        ) from exc
    except Exception as exc:
        raise Exception(  # pylint: disable=broad-exception-raised
            f"Unexpected error occurred when importing litellm: {exc}"
        ) from exc

    class LitellmHandler(LitellmCustomLogger):
        """
        This handler is responsible for instrumenting certain events,
        when using litellm to call LLMs.

        Args:
            LitellmCustomLogger (object): custom logger that allows us
            to override the events to capture.
        """

        def __init__(self):
            super().__init__()

            self.span: Dict[str, CustomSpan] = dict()

        def log_pre_api_call(
            self,
            model,
            messages,
            kwargs,
        ):
            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            type = (  # pylint: disable=redefined-builtin
                "chat"
                if kwargs.get("call_type") in ["completion", "acompletion"]
                else "embedding"
            )

            kind = SpanKind.CLIENT

            self.span[litellm_call_id] = CustomSpan(
                ag.tracer.start_span(name=f"litellm_{kind.name.lower()}", kind=kind)
            )

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                log.error("Agenta SDK - litellm span not recording.")
                return

            span.set_attributes(
                attributes={"node": type},
                namespace="type",
            )

            span.set_attributes(
                attributes={"inputs": {"prompt": kwargs["messages"]}},
                namespace="data",
            )

            span.set_attributes(
                attributes={
                    "configuration": {
                        "model": kwargs.get("model"),
                        **kwargs.get("optional_params"),
                    }
                },
                namespace="meta",
            )

        def log_stream_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                return

        def log_success_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if kwargs.get("stream"):
                return

            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                return

            try:
                result = []
                for choice in response_obj.choices:
                    message = _extract_message_dict(choice.message)
                    result.append(message)

                outputs = {"completion": result}
                span.set_attributes(
                    attributes={"outputs": outputs},
                    namespace="data",
                )

            except Exception:
                pass

            span.set_attributes(
                attributes={
                    "total": (
                        float(kwargs.get("response_cost"))
                        if kwargs.get("response_cost")
                        else None
                    )
                },
                namespace="metrics.unit.costs",
            )

            # Handle both dict and object attribute access for usage, and safely handle None
            usage = getattr(response_obj, "usage", None)
            if isinstance(usage, dict):
                prompt_tokens = usage.get("prompt_tokens")
                completion_tokens = usage.get("completion_tokens")
                total_tokens = usage.get("total_tokens")
            elif usage is not None:
                prompt_tokens = getattr(usage, "prompt_tokens", None)
                completion_tokens = getattr(usage, "completion_tokens", None)
                total_tokens = getattr(usage, "total_tokens", None)
            else:
                prompt_tokens = completion_tokens = total_tokens = None

            span.set_attributes(
                attributes=(
                    {
                        "prompt": float(prompt_tokens) if prompt_tokens else None,
                        "completion": float(completion_tokens)
                        if completion_tokens
                        else None,
                        "total": float(total_tokens) if total_tokens else None,
                    }
                ),
                namespace="metrics.unit.tokens",
            )

            span.set_status(status="OK")

            span.end()

            # Clean up span from dictionary to prevent memory leak
            del self.span[litellm_call_id]

        def log_failure_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                return

            span.record_exception(kwargs["exception"])

            span.set_status(status="ERROR")

            span.end()

            # Clean up span from dictionary to prevent memory leak
            del self.span[litellm_call_id]

        async def async_log_stream_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            if kwargs.get("stream"):
                return

            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                return

        async def async_log_success_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                return

            try:
                result = []
                for choice in response_obj.choices:
                    message = _extract_message_dict(choice.message)
                    result.append(message)

                outputs = {"completion": result}
                span.set_attributes(
                    attributes={"outputs": outputs},
                    namespace="data",
                )

            except Exception:
                pass

            span.set_attributes(
                attributes={
                    "total": (
                        float(kwargs.get("response_cost"))
                        if kwargs.get("response_cost")
                        else None
                    )
                },
                namespace="metrics.unit.costs",
            )

            # Handle both dict and object attribute access for usage
            usage = getattr(response_obj, "usage", None)
            if usage is None:
                prompt_tokens = None
                completion_tokens = None
                total_tokens = None
            elif isinstance(usage, dict):
                prompt_tokens = usage.get("prompt_tokens")
                completion_tokens = usage.get("completion_tokens")
                total_tokens = usage.get("total_tokens")
            else:
                prompt_tokens = getattr(usage, "prompt_tokens", None)
                completion_tokens = getattr(usage, "completion_tokens", None)
                total_tokens = getattr(usage, "total_tokens", None)

            span.set_attributes(
                attributes=(
                    {
                        "prompt": float(prompt_tokens) if prompt_tokens else None,
                        "completion": float(completion_tokens)
                        if completion_tokens
                        else None,
                        "total": float(total_tokens) if total_tokens else None,
                    }
                ),
                namespace="metrics.unit.tokens",
            )

            span.set_status(status="OK")

            span.end()

            # Clean up span from dictionary to prevent memory leak
            del self.span[litellm_call_id]

        async def async_log_failure_event(
            self,
            kwargs,
            response_obj,
            start_time,
            end_time,
        ):
            litellm_call_id = kwargs.get("litellm_call_id")

            if not litellm_call_id:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            span = self.span[litellm_call_id]

            if not span:
                log.warning("Agenta SDK - litellm tracing failed")
                return

            if not span.is_recording():
                return

            span.record_exception(kwargs["exception"])

            span.set_status(status="ERROR")

            span.end()

            # Clean up span from dictionary to prevent memory leak
            del self.span[litellm_call_id]

    return LitellmHandler()
