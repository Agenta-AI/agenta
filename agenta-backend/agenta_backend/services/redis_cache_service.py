import json
from typing import Dict, Any, Coroutine, Callable

from agenta_backend.services import filters
from agenta_backend.utils import redis_utils
from agenta_backend.models.api.observability_models import ObservabilityDashboardData


async def cache_observability_data(
    data_func: Coroutine[None, None, Callable[[str, Any], ObservabilityDashboardData]],
    **kwargs,
) -> ObservabilityDashboardData:

    app_id = kwargs["app_id"]
    parameters = kwargs["parameters"]
    redis = redis_utils.redis_connection()
    cached_data = redis.get(f"obs_dashboard_data_{app_id}")
    if cached_data is not None:
        loaded_data = json.loads(cached_data)
        spans_data = loaded_data["data"]
        len_of_spans_db = len(spans_data)
        filtered_data = filters.filter_observability_dashboard_data_by_params(
            parameters, spans_data
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
                "total_cost": round(sum([span["cost"] for span in spans_data]), 5),
                "avg_cost": round(
                    sum([span["cost"] for span in spans_data]) / len_of_spans_db, 5
                ),
                "avg_latency": round(
                    sum([span["latency"] for span in spans_data]) / len_of_spans_db, 5
                ),
                "total_tokens": sum([span["total_tokens"] for span in spans_data]),
                "avg_tokens": sum([span["total_tokens"] for span in spans_data])
                / len_of_spans_db,
            }
        )

    data = await data_func(app_id, parameters)
    redis.setex(f"obs_dashboard_data_{app_id}", 1800, data.json())
    return data
