from typing import List, Union, Dict, Any

from agenta_backend.models.api.observability_models import (
    Span,
    Trace,
    ObservabilityData,
    GenerationFilterParams,
    ObservabilityDashboardData,
    ObservabilityDashboardDataRequestParams,
)


def filter_observability_dashboard_data_by_params(
    params: ObservabilityDashboardDataRequestParams,
    observability_data: List[Union[ObservabilityData, Dict[str, Any]]],
):
    """Filter observability dashboard data by the provided params.

    Args:
        params (ObservabilityDashboardDataRequestParams): the params to filter data with
        observability_data (List[Union[ObservabilityData, Dict[str, Any]]]): data to filter

    Returns:
        filtered list of data
    """

    filtered_data = []
    if observability_data != [] and isinstance(observability_data[0], dict):
        filtered_data = [
            ObservabilityData(**obs_data) for obs_data in observability_data
        ]
    else:
        filtered_data = observability_data

    if params.startTime or params.endTime:
        def filter_by_timestamp(data: ObservabilityData):
            epoch_time = int(data.timestamp.timestamp()) * 1000
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
    """Filter document by the provided params.

    Args:
        filters (GenerationFilterParams): the params to filter with
        document (Union[Span, Trace]): expects either a span or trace document

    Returns:
        bool: True or False if param matches condition
    """

    if filters:
        if filters.variant and document.variant.variant_name != filters.variant:
            return False
        if filters.environment and document.environment != filters.environment:
            return False
    return True


def filter_and_aggregate_cache_observability_data(
    params: ObservabilityDashboardDataRequestParams,
    observability_data: List[Dict[str, Any]],
) -> ObservabilityDashboardData:
    """Filter and aggregate cache data for the dashboard.

    Args:
        params (ObservabilityDashboardDataRequestParams): the params to filter data with
        observability_data (List[Dict[str, Any]]): cached data to filter

    Returns:
        aggregated dashboard data
    """

    len_of_spans_db = len(observability_data)
    filtered_data = filter_observability_dashboard_data_by_params(
        params, observability_data
    )
    if filtered_data == []:
        return ObservabilityDashboardData(
            **{
                "data": [],
                "total_count": 0,
                "failure_rate": 0,
                "total_cost": 0,
                "avg_cost": 0,
                "avg_latency": 0,
                "total_tokens": 0,
                "avg_tokens": 0,
            }
        )
    return ObservabilityDashboardData(
        **{
            "data": filtered_data,
            "total_count": len_of_spans_db,
            "failure_rate": 0,
            "total_cost": round(sum([span["cost"] for span in observability_data]), 5),
            "avg_cost": round(
                sum([span["cost"] for span in observability_data]) / len_of_spans_db, 5
            ),
            "avg_latency": round(
                sum([span["latency"] for span in observability_data]) / len_of_spans_db,
                5,
            ),
            "total_tokens": sum([span["total_tokens"] for span in observability_data]),
            "avg_tokens": sum([span["total_tokens"] for span in observability_data])
            / len_of_spans_db,
        }
    )
