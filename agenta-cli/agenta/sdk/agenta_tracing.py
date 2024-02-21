# Stdlib Imports
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Optional, List

# Own Imports
from agenta.client.backend import client
from agenta.client.backend.client import AsyncObservabilityClient
# Stdlib Imports
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Optional, List

# Own Imports
from agenta.client.backend import client
from agenta.client.backend.client import AsyncObservabilityClient


class LLMTracing:
    def __init__(self, base_url: str, api_key: Optional[str] = None):
        self.base_url = base_url
        self.api_key = api_key

    def initialize_client(self) -> AsyncObservabilityClient:
        return client.AsyncAgentaApi(
            base_url=self.base_url, api_key=self.api_key, timeout=60  # type: ignore
        ).observability

    async def create_trace(
        self,
        client: AsyncObservabilityClient,
        app_id: str,
        variant_id: str,
        spans: List[str],
        **kwargs: Dict[str, Any]
    ):
        # calculate the latency between the trace start time and end time
        trace_end_time = datetime.now()
        latency: timedelta = trace_end_time - kwargs["trace_start_time"]  # type: ignore
        trace = await client.create_trace(
            app_id=app_id,
            variant_id=variant_id,
            cost=kwargs["cost"],  # type: ignore
            latency=latency.total_seconds(),
            status="INITIATED",
            token_consumption=kwargs["token_consumption"],  # type: ignore
            tags=[],
            end_time=trace_end_time,
            spans=spans,
        )
        return trace

    async def finalize_trace(
        self, client: AsyncObservabilityClient, trace_id: str, status: str
    ) -> bool:
        return await client.update_trace_status(trace_id=trace_id, status=status)

    async def create_span(
        self,
        client: AsyncObservabilityClient,
        parent_span_id: Optional[str],
        event_name: str,
        **kwargs: Dict[str, Any]
    ):
        span = await client.create_span(
            parent_span_id=parent_span_id,
            meta=kwargs["meta"],  # type: ignore
            event_name=event_name,
            event_type="generation",
            status="INITIATED",
            inputs=kwargs["inputs"],  # type: ignore
            outputs=kwargs["outputs"],  # type: ignore
            prompt_template=kwargs["prompt_template"],  # type: ignore
            tokens_input=kwargs["prompts_token"],  # type: ignore
            tokens_output=kwargs["completion_tokens"],  # type: ignore
            token_total=kwargs["total_tokens"],  # type: ignore
            cost=kwargs["cost"],  # type: ignore
            tags=[],
        )
        return span

    def set_span_tag(self, tag: str):
        raise NotImplementedError

    async def start_tracing(self, app_id: str, variant_id: str, **kwargs: Dict[str, Any]):
        client = self.initialize_client()

        try:
            trace_starting = datetime.now()
            span = await self.create_span(
                client, None, event_name=str(uuid.uuid4()), kwargs=kwargs
            )
            trace = await self.create_trace(
                client,
                app_id=app_id,
                variant_id=variant_id,
                spans=[span],
                kwargs={**kwargs, "trace_start_time": trace_starting},
            )
        except Exception:
            # TODO: handle logic to handle case of failure
            return
        finally:
            await self.finalize_trace(client, trace, "SUCCESS")
            return
