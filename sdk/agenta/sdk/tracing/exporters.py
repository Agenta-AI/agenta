from typing import Sequence, Dict, List, Optional, Any
from threading import Thread
from os import environ
from uuid import UUID

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import (
    ConsoleSpanExporter,
    SpanExporter,
    SpanExportResult,
    ReadableSpan,
)

from agenta.sdk.utils.constants import TRUTHY
from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.utils.cache import TTLLRUCache
from agenta.sdk.contexts.tracing import (
    otlp_context_manager,
    otlp_context,
    OTLPContext,
)


log = get_module_logger(__name__)

_ASYNC_EXPORT = environ.get("AGENTA_OTLP_ASYNC_EXPORT", "true").lower() in TRUTHY


class InlineTraceExporter(SpanExporter):
    def __init__(
        self,
        registry: Dict[str, List[ReadableSpan]],
    ):
        self._shutdown = False
        self._registry = registry

    def export(
        self,
        spans: Sequence[ReadableSpan],
    ) -> SpanExportResult:
        if self._shutdown:
            return

        with suppress():
            for span in spans:
                trace_id = span.get_span_context().trace_id

                if trace_id not in self._registry:
                    self._registry[trace_id] = []

                self._registry[trace_id].append(span)

            return

    def shutdown(self) -> None:
        self._shutdown = True

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True

    def is_ready(
        self,
        trace_id: int,
    ) -> bool:
        is_ready = trace_id in self._registry
        return is_ready

    def fetch(
        self,
        trace_id: int,
    ) -> List[ReadableSpan]:
        trace = self._registry.get(trace_id, [])

        if trace_id in self._registry:
            del self._registry[trace_id]

        return trace


class OTLPExporter(OTLPSpanExporter):
    _MAX_RETRY_TIMEOUT = 2

    def __init__(
        self,
        *args,
        credentials: Optional[TTLLRUCache] = None,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)

        self.credentials = credentials

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        grouped_spans: Dict[Optional[str], List[ReadableSpan]] = dict()

        for span in spans:
            trace_id = span.get_span_context().trace_id

            credentials = None
            if self.credentials:
                credentials = str(self.credentials.get(trace_id))

            if credentials not in grouped_spans:
                grouped_spans[credentials] = list()

            grouped_spans[credentials].append(span)

        serialized_spans = []

        for credentials, _spans in grouped_spans.items():
            with otlp_context_manager(
                context=OTLPContext(
                    credentials=credentials,
                )
            ):
                for _span in _spans:
                    trace_id = _span.get_span_context().trace_id
                    span_id = _span.get_span_context().span_id

                    # log.debug(
                    #     "[SPAN]  [EXPORT]",
                    #     trace_id=UUID(int=trace_id).hex,
                    #     span_id=UUID(int=span_id).hex[-16:],
                    # )

                serialized_spans.append(super().export(_spans))

        if all(serialized_spans):
            return SpanExportResult.SUCCESS
        else:
            return SpanExportResult.FAILURE

    def _export(self, serialized_data: bytes, timeout_sec: Optional[float] = None):
        try:
            credentials = otlp_context.get().credentials

            if credentials:
                self._session.headers.update({"Authorization": credentials})

            def __export():
                with suppress():
                    resp = None
                    if timeout_sec is not None:
                        resp = super(OTLPExporter, self)._export(
                            serialized_data,
                            timeout_sec,
                        )
                    else:
                        resp = super(OTLPExporter, self)._export(
                            serialized_data,
                        )

                    # log.debug(
                    #     "[SPAN] [_EXPORT]",
                    #     data=serialized_data,
                    #     resp=resp,
                    # )

            if _ASYNC_EXPORT is True:
                # log.debug("[SPAN] [ASYNC.X]")
                thread = Thread(target=__export, daemon=True)
                thread.start()
            else:
                # log.debug("[SPAN] [ SYNC.X]")
                return __export()

        except Exception as e:
            log.error(f"Export failed with error: {e}", exc_info=True)

        finally:

            class Response:
                ok = True

            return Response()


ConsoleExporter = ConsoleSpanExporter
InlineExporter = InlineTraceExporter
