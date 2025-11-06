from typing import Optional, Union, Any, Dict

from opentelemetry.trace import SpanContext
from opentelemetry.trace.status import Status, StatusCode
from opentelemetry.sdk.trace import Span

from agenta.sdk.engines.tracing.attributes import serialize


class CustomSpan(Span):  # INHERITANCE FOR TYPING ONLY
    def __init__(
        self,
        span: Span,
    ) -> None:
        super().__init__(  # INHERITANCE FOR TYPING ONLY
            name=span.name,
            context=span.context,
            parent=span.parent,
            sampler=span._sampler,
            trace_config=span._trace_config,
            resource=span.resource,
            attributes=span.attributes,
            events=span.events,
            links=span.links,
            kind=span.kind,
            span_processor=span._span_processor,
            instrumentation_info=span.instrumentation_info,
            record_exception=span._record_exception,
            set_status_on_exception=span._set_status_on_exception,
            limits=span._limits,
            instrumentation_scope=span.instrumentation_scope,
        )

        self._span = span

    ## --- PROXY METHODS --- ##

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
