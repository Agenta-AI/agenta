from typing import Sequence, Dict, List, Optional
from threading import Lock, Thread
from os import environ
from time import monotonic

from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
    OTLPSpanExporter,
)
from opentelemetry.sdk.trace import (
    ReadableSpan,
)
from opentelemetry.sdk.trace.export import (
    ConsoleSpanExporter,
    SpanExporter,
    SpanExportResult,
)

from agenta.sdk.utils.constants import TRUTHY
from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.utils.cache import TTLLRUCache
from agenta.sdk.contexts.tracing import (
    otlp_context_manager,
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
            return SpanExportResult.SUCCESS

        with suppress():
            for span in spans:
                trace_id = span.get_span_context().trace_id

                if trace_id not in self._registry:
                    self._registry[trace_id] = []

                self._registry[trace_id].append(span)

            return SpanExportResult.SUCCESS

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
    def __init__(
        self,
        *args,
        credentials: Optional[TTLLRUCache] = None,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)

        self.credentials = credentials
        self._threads: List[Thread] = []
        self._threads_lock = Lock()

        # The OTLP HTTP client of opentelemetry 1.45 sends every request through
        # the transport session. Wrap that session (also one loaded from a
        # credential provider) so each request carries the credentials of the
        # group that is exporting. Nothing is shared between groups. A provider
        # session that sets Authorization itself still wins, as it did with
        # opentelemetry 1.43, because the provider owns the collector auth.
        session = self._client._transport._session
        request = session.request

        def request_with_credentials(method, url, *args, headers=None, **kwargs):
            credentials = OTLPContext.get().credentials

            if credentials:
                headers = {**(headers or {}), "Authorization": credentials}

            return request(method, url, *args, headers=headers, **kwargs)

        session.request = request_with_credentials

    def shutdown(self) -> None:
        # Let the accepted async groups finish before the exporter closes. Each
        # group stops retrying after the export timeout, so wait at most that
        # long in total. A response that never completes must not block exit.
        deadline = monotonic() + self._client._timeout
        with self._threads_lock:
            threads, self._threads = self._threads, []

        for thread in threads:
            thread.join(max(deadline - monotonic(), 0))

        super().shutdown()

    def _export_group(
        self,
        credentials: Optional[str],
        spans: List[ReadableSpan],
    ) -> bool:
        with otlp_context_manager(context=OTLPContext(credentials=credentials)):
            return super().export(spans) == SpanExportResult.SUCCESS

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        grouped_spans: Dict[Optional[str], List[ReadableSpan]] = dict()

        for span in spans:
            trace_id = span.get_span_context().trace_id

            credentials = None
            if self.credentials:
                credentials = self.credentials.get(trace_id)

            if credentials not in grouped_spans:
                grouped_spans[credentials] = list()

            grouped_spans[credentials].append(span)

        results = []

        for credentials, _spans in grouped_spans.items():
            if _ASYNC_EXPORT is True:
                thread = Thread(
                    target=self._export_group,
                    args=(credentials, _spans),
                    daemon=False,
                )
                thread.start()
                with self._threads_lock:
                    self._threads = [t for t in self._threads if t.is_alive()]
                    self._threads.append(thread)
                results.append(True)
            else:
                try:
                    results.append(self._export_group(credentials, _spans))
                except Exception as e:
                    log.error(f"Export failed with error: {e}", exc_info=True)
                    results.append(False)

        if all(results):
            return SpanExportResult.SUCCESS
        else:
            return SpanExportResult.FAILURE


ConsoleExporter = ConsoleSpanExporter
InlineExporter = InlineTraceExporter
