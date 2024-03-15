from datetime import datetime, timedelta
from typing import List, Union, Dict, Any

from agenta_backend.models.db_models import SpanDB
from agenta_backend.models.api.observability_models import (
    Span,
    Trace,
    ObservabilityData,
    GenerationFilterParams,
    ObservabilityDashboardData,
    ObservabilityDashboardDataRequestParams,
)


def filter_by_time_range(time_range: str) -> datetime:
    """
    Filters a datetime object based on a specified time range.

    Args:
        time_range (str): The time range to filter by

    Returns:
        time_range (datetime): Specific time depends on the value of the time_range
    """

    now = datetime.now()
    if time_range == "24_hours":
        return now - timedelta(hours=24)
    elif time_range == "7_days":
        return now - timedelta(days=7)
    elif time_range == "30_days":
        return now - timedelta(days=30)
    elif time_range == "60_days":
        return now - timedelta(days=60)
    elif time_range == "90_days":
        return now - timedelta(days=90)
    elif time_range == "180_days":
        return now - timedelta(days=180)
    else:
        raise ValueError("Invalid time parameter.")


def calculate_target_hours() -> List[int]:
    now = datetime.now()
    target_hours = []
    for i in range(24):
        hour = (now - timedelta(hours=i)).hour
        target_hours.append(hour)
    return target_hours


def prepares_spans_aggregation_by_timerange(time_range: str):
    """Prepares aggregation statement by time_range.

    Args:
        time_range (str): The time range to filter by

    Returns:
        Dict: mapping based on time range
    """

    if time_range == "24_hours":
        date_trunc_unit = "hour"
    elif time_range in ["7_days", "30_days"]:
        date_trunc_unit = "day"
    else:  # for 60_days, 90_days, and 180_days
        date_trunc_unit = "month"

    time_range_mappings = {
        "$group": {
            "_id": {"$dateTrunc": {"date": "$created_at", "unit": date_trunc_unit}},
            "latency": {
                "$sum": {"$divide": [{"$subtract": ["$end_time", "$start_time"]}, 1000]}
            },
            "success_count": {
                "$sum": {"$cond": [{"$eq": ["$status.value", "SUCCESS"]}, 1, 0]}
            },
            "failure_count": {
                "$sum": {"$cond": [{"$eq": ["$status.value", "FAILURE"]}, 1, 0]}
            },
            "cost": {"$sum": "$cost"},
            "total_tokens": {"$sum": "$token_total"},
            "prompt_tokens": {"$sum": "$tokens_input"},
            "completion_tokens": {"$sum": "$tokens_output"},
        }
    }

    return time_range_mappings


def filter_observability_dashboard_spans_db_by_filters(
    app_id: str, params: ObservabilityDashboardDataRequestParams
):
    if params.environment and params.variant:
        filtered_spans = SpanDB.find(
            SpanDB.trace.app_id == app_id,
            SpanDB.environment == params.environment,
            SpanDB.trace.base_id == params.variant,
            fetch_links=True,
        )
    elif params.variant:
        filtered_spans = SpanDB.find(
            SpanDB.trace.app_id == app_id,
            SpanDB.trace.base_id == params.variant,
            fetch_links=True,
        )
    elif params.environment:
        filtered_spans = SpanDB.find(
            SpanDB.trace.app_id == app_id,
            SpanDB.environment == params.environment,
            fetch_links=True,
        )
    else:
        filtered_spans = SpanDB.find(SpanDB.trace.app_id == app_id, fetch_links=True)
    return filtered_spans


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
        if filters.variant and document["variant"]["variant_name"] != filters.variant:
            return False
        if filters.environment and document["environment"] != filters.environment:
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
