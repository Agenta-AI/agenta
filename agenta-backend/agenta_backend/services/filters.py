from typing import List, Union, Dict, Any

from agenta_backend.models.api.observability_models import (
    Span,
    Trace,
    ObservabilityData,
    GenerationFilterParams,
    ObservabilityDashboardDataRequestParams,
)


def filter_observability_dashboard_data_by_params(
    params: ObservabilityDashboardDataRequestParams,
    observability_data: List[Union[ObservabilityData, Dict[str, Any]]],
):
    filtered_data = []
    if observability_data != [] and isinstance(observability_data[0], dict):
        filtered_data = [
            ObservabilityData(**obs_data) for obs_data in observability_data
        ]
    else:
        filtered_data = observability_data

    if params.startTime or params.endTime:

        def filter_by_timestamp(data: ObservabilityData):
            epoch_time = int(data.timestamp.timestamp())
            return params.startTime <= epoch_time <= params.endTime

        filtered_data = filter(filter_by_timestamp, filtered_data)

    if params.environment:
        filtered_data = filter(
            lambda data: data.environment == params.environment, filtered_data
        )

    if params.variant:
        filtered_data = filter(
            lambda data: data.variant == params.variant, filtered_data
        )
    return list(filtered_data)


def filter_document_by_filter_params(
    filters: GenerationFilterParams, document: Union[Span, Trace]
) -> bool:
    if filters:
        if filters.variant and document.variant.variant_name != filters.variant:
            return False
        if filters.environment and document.environment != filters.environment:
            return False
    return True
