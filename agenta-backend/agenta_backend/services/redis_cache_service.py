import json
from typing import Any, Coroutine, Callable

from agenta_backend.services import filters
from agenta_backend.utils import redis_utils
from agenta_backend.models.api.observability_models import ObservabilityDashboardData


async def cache_observability_data(
    data_func: Coroutine[None, None, Callable[[str, Any], ObservabilityDashboardData]],
    **kwargs,
) -> ObservabilityDashboardData:
    # Prepare required args
    app_id = kwargs["app_id"]
    parameters = kwargs["parameters"]

    # Initialize redis connection
    redis = redis_utils.redis_connection()

    # Retrieve cache key and return data if it exists
    cached_data = redis.get(f"obs_dashboard_data_{app_id}")
    if cached_data is not None:
        loaded_data = json.loads(cached_data)
        return filters.filter_and_aggregate_cache_observability_data(
            parameters, loaded_data["data"]
        )

    # Retrieve observability dashboard data and cache data for re-use
    data = await data_func(app_id, parameters)
    redis.setex(f"obs_dashboard_data_{app_id}", 1800, data.json())
    return data
