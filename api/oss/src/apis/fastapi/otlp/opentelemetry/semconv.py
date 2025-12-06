from json import loads

VERSION = "0.4.1"

V_0_4_1_ATTRIBUTES_EXACT = [
    # OPENLLMETRY
    ("gen_ai.system", "ag.meta.system"),
    ("gen_ai.request.base_url", "ag.meta.request.base_url"),
    ("gen_ai.request.endpoint", "ag.meta.request.endpoint"),
    ("gen_ai.request.headers", "ag.meta.request.headers"),
    ("gen_ai.request.type", "ag.type.node"),
    ("gen_ai.request.streaming", "ag.meta.request.streaming"),
    ("gen_ai.request.model", "ag.meta.request.model"),
    ("gen_ai.request.max_tokens", "ag.meta.request.max_tokens"),
    ("gen_ai.request.temperature", "ag.meta.request.temperature"),
    ("gen_ai.request.top_p", "ag.meta.request.top_p"),
    ("gen_ai.response.model", "ag.meta.response.model"),
    ("gen_ai.usage.prompt_tokens", "ag.metrics.unit.tokens.prompt"),
    ("gen_ai.usage.completion_tokens", "ag.metrics.unit.tokens.completion"),
    ("gen_ai.usage.total_tokens", "ag.metrics.unit.tokens.total"),
    ("llm.headers", "ag.meta.request.headers"),
    ("llm.request.type", "ag.type.node"),
    ("llm.top_k", "ag.meta.request.top_k"),
    ("llm.is_streaming", "ag.meta.request.streaming"),
    ("llm.usage.total_tokens", "ag.metrics.unit.tokens.total"),
    ("gen_ai.openai.api_base", "ag.meta.request.base_url"),
    ("db.system", "ag.meta.system"),
    ("db.vector.query.top_k", "ag.meta.request.top_k"),
    ("pinecone.query.top_k", "ag.meta.request.top_k"),
    ("traceloop.span.kind", "ag.type.node"),
    ("traceloop.entity.name", "ag.node.name"),
    # OPENINFERENCE
    ("output.value", "ag.data.outputs"),
    ("input.value", "ag.data.inputs"),
    ("embedding.model_name", "ag.meta.request.model"),
    ("llm.invocation_parameters", "ag.meta.request"),
    ("llm.model_name", "ag.meta.request.model"),
    ("llm.provider", "ag.meta.provider"),
    ("llm.system", "ag.meta.system"),
]
V_0_4_1_ATTRIBUTES_PREFIX = [
    # OPENLLMETRY
    ("gen_ai.prompt", "ag.data.inputs.prompt"),
    ("gen_ai.completion", "ag.data.outputs.completion"),
    ("llm.request.functions", "ag.data.inputs.functions"),
    ("llm.request.tools", "ag.data.inputs.tools"),
    # OPENINFERENCE
    ("llm.token_count", "ag.metrics.unit.tokens"),
    ("llm.input_messages", "ag.data.inputs.prompt"),
    ("llm.output_messages", "ag.data.outputs.completion"),
]

V_0_4_1_ATTRIBUTES_DYNAMIC = [
    # OPENLLMETRY
    ("traceloop.entity.input", lambda x: ("ag.data.inputs", loads(x).get("inputs"))),
    ("traceloop.entity.output", lambda x: ("ag.data.outputs", loads(x).get("outputs"))),
]


V_0_4_1_MAPS = {
    "attributes": {
        "exact": {
            "from": {otel: agenta for otel, agenta in V_0_4_1_ATTRIBUTES_EXACT[::-1]},
            "to": {agenta: otel for otel, agenta in V_0_4_1_ATTRIBUTES_EXACT[::-1]},
        },
        "prefix": {
            "from": {otel: agenta for otel, agenta in V_0_4_1_ATTRIBUTES_PREFIX[::-1]},
            "to": {agenta: otel for otel, agenta in V_0_4_1_ATTRIBUTES_PREFIX[::-1]},
        },
        "dynamic": {
            "from": {otel: agenta for otel, agenta in V_0_4_1_ATTRIBUTES_DYNAMIC[::-1]}
        },
    },
}
V_0_4_1_KEYS = {
    "attributes": {
        "exact": {
            "from": list(V_0_4_1_MAPS["attributes"]["exact"]["from"].keys()),
            "to": list(V_0_4_1_MAPS["attributes"]["exact"]["to"].keys()),
        },
        "prefix": {
            "from": list(V_0_4_1_MAPS["attributes"]["prefix"]["from"].keys()),
            "to": list(V_0_4_1_MAPS["attributes"]["prefix"]["to"].keys()),
        },
        "dynamic": {
            "from": list(V_0_4_1_MAPS["attributes"]["dynamic"]["from"].keys()),
        },
    },
}


MAPS = {
    "0.4.1": V_0_4_1_MAPS,  # LATEST
}
KEYS = {
    "0.4.1": V_0_4_1_KEYS,  # LATEST
}

CODEX = {"maps": MAPS[VERSION], "keys": KEYS[VERSION]}
