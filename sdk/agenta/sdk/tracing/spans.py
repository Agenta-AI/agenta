from typing import Optional, Union, Any, Dict

from opentelemetry.trace import SpanContext, Span as TraceSpan
from opentelemetry.trace.status import Status, StatusCode

from agenta.sdk.tracing.attributes import serialize


class CustomSpan:
    """
    A wrapper around OpenTelemetry spans that adds namespace support for attributes.

    This class wraps any OpenTelemetry span (from SDK or API) and provides
    custom methods with namespace support for attributes serialization.
    It uses composition rather than inheritance to work with any span type,
    including spans created by third-party instrumentation libraries.

    Note: Previously this class inherited from opentelemetry.sdk.trace.Span and
    called super().__init__() with SDK-specific internal attributes. This failed
    for non-SDK spans (e.g., from opentelemetry-instrumentation-langchain) which
    don't have attributes like _sampler, _trace_config, etc.
    """

    def __init__(
        self,
        span: TraceSpan,
    ) -> None:
        self._span = span

    ## --- PROXY METHODS --- ##

    @property
    def name(self) -> str:
        return self._span.name

    @property
    def context(self) -> SpanContext:
        return self._span.get_span_context()

    @property
    def parent(self):
        # parent may not exist on all span types, return None if not available
        return getattr(self._span, "parent", None)

    def get_span_context(self):
        return self._span.get_span_context()

    def is_recording(self) -> bool:
        return self._span.is_recording()

    def update_name(
        self,
        name: str,
    ) -> None:
        self._span.update_name(name)

    def set_status(
        self,
        status: Union[Status, StatusCode],
        description: Optional[str] = None,
    ) -> None:
        self._span.set_status(
            status=status,
            description=description,
        )

    def end(self) -> None:
        self._span.end()

    ## --- CUSTOM METHODS W/ ATTRIBUTES SERALIZATION --- ##

    def set_attributes(
        self,
        attributes: Dict[str, Any],
        namespace: Optional[str] = None,
        max_depth: Optional[int] = None,
    ) -> None:
        self._span.set_attributes(
            attributes=serialize(
                namespace=namespace,
                attributes=attributes,
                max_depth=max_depth,
            )
        )

    def set_attribute(
        self,
        key: str,
        value: Any,
        namespace: Optional[str] = None,
    ) -> None:
        self.set_attributes(
            attributes={key: value},
            namespace=namespace,
        )

    def add_event(
        self,
        name: str,
        attributes: Optional[Dict[str, Any]] = None,
        timestamp: Optional[int] = None,
        namespace: Optional[str] = None,
    ) -> None:
        self._span.add_event(
            name=name,
            attributes=serialize(
                namespace=namespace,
                attributes=attributes,
            ),
            timestamp=timestamp,
        )

    def add_link(
        self,
        context: SpanContext,
        attributes: Optional[Dict[str, Any]] = None,
        namespace: Optional[str] = None,
    ) -> None:
        self._span.add_link(
            context=context,
            attributes=serialize(
                namespace=namespace,
                attributes=attributes,
            ),
        )

    def record_exception(
        self,
        exception: BaseException,
        attributes: Optional[Dict[str, Any]] = None,
        timestamp: Optional[int] = None,
        escaped: bool = False,
        namespace: Optional[str] = None,
    ) -> None:
        self._span.record_exception(
            exception=exception,
            attributes=serialize(
                namespace=namespace,
                attributes=attributes,
            ),
            timestamp=timestamp,
            escaped=escaped,
        )
