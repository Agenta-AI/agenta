import os

from oss.src.utils.env import env

# litellm reads this once, at import (`import agenta` imports it), and otherwise fetches its
# price map over the network.
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = str(env.llm.litellm_local_model_cost_map)
