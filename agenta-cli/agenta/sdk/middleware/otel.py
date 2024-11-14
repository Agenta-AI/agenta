from typing import Callable, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request, Depends, Query

from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.baggage.propagation import W3CBaggagePropagator

from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.middleware.refs import Reference


def _parse_application_ref(
    app_id: str = Query(None),
    app_slug: str = Query(None),
    application_id: str = Query(None),
    application_slug: str = Query(None),
) -> Optional[Reference]:
    if not any([app_id, app_slug, application_id, application_slug]):
        return None

    return Reference(
        id=app_id or application_id,
        slug=app_slug or application_slug,
    )


def _parse_variant_ref(
    variant_id: str = Query(None),
    variant_slug: str = Query(None),
    variant_version: str = Query(None),
) -> Optional[Reference]:
    if not any([variant_id, variant_slug, variant_version]):
        return None

    return Reference(
        id=variant_id,
        slug=variant_slug,
        version=variant_version,
    )


def _parse_experiment_ref(
    experiment_id: str = Query(None),
    experiment_slug: str = Query(None),
    experiment_version: str = Query(None),
) -> Optional[Reference]:
    if not any([experiment_id, experiment_slug, experiment_version]):
        return None

    return Reference(
        id=experiment_id,
        slug=experiment_slug,
        version=experiment_version,
    )


def _parse_ref_to_baggage(
    ref: Reference,
    prefix: str,
) -> str:
    baggage = ",".join(
        filter(
            None,
            [
                f"{prefix}_id={ref.id}" if ref.id else None,
                f"{prefix}_slug={ref.slug}" if ref.slug else None,
                f"{prefix}_version={ref.version}" if ref.version else None,
            ],
        )
    )

    return baggage


def _parse_refs_to_baggage(
    application_ref: Optional[Reference] = None,
    variant_ref: Optional[Reference] = None,
    experiment_ref: Optional[Reference] = None,
) -> str:
    baggage = ",".join(
        filter(
            None,
            [
                _parse_ref_to_baggage(application_ref, "application"),
                _parse_ref_to_baggage(variant_ref, "variant"),
                _parse_ref_to_baggage(experiment_ref, "experiment"),
            ],
        )
    )

    return baggage


class OpenTelemetryMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
        application_ref: Optional[Reference] = Depends(_parse_application_ref),
        variant_ref: Optional[Reference] = Depends(_parse_variant_ref),
        experiment_ref: Optional[Reference] = Depends(_parse_experiment_ref),
    ):
        with suppress():

            headers = dict(request.headers)
            traceparent_carrier = {"traceparent": headers.get("Traceparent")}
            traceparent_context = TraceContextTextMapPropagator().extract(
                carrier=traceparent_carrier,
            )
            print(f"traceparent context: {traceparent_context}")

            baggage_carrier = {"baggage": headers.get("Baggage")}
            baggage_context = W3CBaggagePropagator().extract(
                carrier=baggage_carrier,
                context=traceparent_context,
            )
            print(f"baggage context: {baggage_context}")

            references_carrier = {
                "baggage": _parse_refs_to_baggage(
                    application_ref,
                    variant_ref,
                    experiment_ref,
                )
            }
            references_context = W3CBaggagePropagator().extract(
                carrier=references_carrier,
                context=baggage_context,
            )
            print(f"references context: {references_context}")

            final_context = references_context or baggage_context or traceparent_context

            request.state.context = final_context

            print(f"context: {request.state.context}")

            return await call_next(request)
