from json import dumps

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.workflows.types import Data


log = get_module_logger(__name__)


async def exact_match_v1(
    *,
    parameters: Data,
    inputs: Data,
    outputs: Data | str,
) -> Data:
    success = False

    try:
        reference_key = parameters.get("reference_key", None)
        reference_outputs = inputs.get(reference_key, None)

        if isinstance(outputs, str) and isinstance(reference_outputs, str):
            success = outputs == reference_outputs
        elif isinstance(outputs, dict) and isinstance(reference_outputs, dict):
            outputs = dumps(outputs, sort_keys=True)
            reference_outputs = dumps(reference_outputs, sort_keys=True)
            success = outputs == reference_outputs

    except:  # pylint: disable=bare-except
        log.error("Error in exact_match_v1", exc_info=True)

    return {"success": success}
