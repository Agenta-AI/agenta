# Stdlib Imports
import uuid
from datetime import datetime
from typing import Optional, Dict, Any, Optional

# Own Imports
from agenta.client.backend import client
from agenta.client.backend.types.span_status import SpanStatus
from agenta.client.backend.client import AsyncObservabilityClient


class LLMTracing:
    def __init__(self, base_url: str, api_key: Optional[str] = None):
        self.base_url = base_url + "/api"
        self.api_key = api_key if api_key is not None else ""

    def initialize_client(self) -> AsyncObservabilityClient:
        return client.AsyncAgentaApi(
            base_url=self.base_url, api_key=self.api_key, timeout=120  # type: ignore
        ).observability

    async def create_trace(
        self,
        client: AsyncObservabilityClient,
        app_id: str,
        base_id: str,
        config_name: str,
        **kwargs: Dict[str, Any],
    ):
        trace = await client.create_trace(
            app_id=app_id,
            base_id=base_id,
            config_name=config_name,
            cost=kwargs["cost"],  # type: ignore
            environment=kwargs["environment"],  # type: ignore
            status="INITIATED",
            token_consumption=kwargs["total_tokens"],  # type: ignore
            tags=[],
        )
        return trace

    async def finalize_trace(
        self, client: AsyncObservabilityClient, trace_id: str, status: str
    ) -> bool:
        return await client.update_trace(
            trace_id=trace_id, status=status, end_time=datetime.now()
        )

    async def create_span(
        self,
        client: AsyncObservabilityClient,
        trace_id: str,
        parent_span_id: Optional[str],
        event_name: str,
        **kwargs: Dict[str, Any],
    ):
        span = await client.create_span(
            trace_id=trace_id,
            parent_span_id=parent_span_id,
            meta=kwargs["meta"],  # type: ignore
            event_name=event_name,
            event_type="generation",
            environment=kwargs["environment"],  # type: ignore
            status=SpanStatus(**{"value": "SUCCESS", "error": None}),
            inputs=kwargs["inputs"],  # type: ignore
            outputs=kwargs["outputs"],  # type: ignore
            prompt_system=kwargs["prompt_system"],  # type: ignore
            prompt_user=kwargs["prompt_user"],  # type: ignore
            tokens_input=kwargs["prompt_tokens"],  # type: ignore
            tokens_output=kwargs["completion_tokens"],  # type: ignore
            token_total=kwargs["total_tokens"],  # type: ignore
            cost=kwargs["cost"],  # type: ignore
            tags=[],
        )
        return span

    def set_span_tag(self, tag: str):
        raise NotImplementedError

    async def start_tracing(
        self, app_id: str, base_id: str, config_name: str, **kwargs: Dict[str, Any]
    ):
        trace = None
        client = self.initialize_client()
        try:
            trace_starting = datetime.now()
            trace = await self.create_trace(
                client,
                app_id=app_id,
                base_id=base_id,
                config_name=config_name,
                **{**kwargs, "trace_start_time": trace_starting},  # type: ignore
            )
            await self.create_span(
                client, trace, None, event_name=str(uuid.uuid4()), **kwargs
            )
        except KeyError as exc:
            print(f"Something happened when tracing LLM app. Error: {str(exc)}")
            return
        except Exception as exc:
            print("Error tracing LLM app ", app_id, str(exc))
            return
        finally:
            if trace is not None:
                await self.finalize_trace(client, trace, "SUCCESS")
            return
