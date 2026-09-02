from oss.src.apis.fastapi.otlp.opentelemetry.semconv import V_0_4_1_MAPS


def test_reported_genai_cost_maps_to_agenta_cost_metric():
    mappings = V_0_4_1_MAPS["attributes"]["exact"]

    assert mappings["from"]["gen_ai.usage.cost"] == "ag.metrics.unit.costs.total"
    assert mappings["to"]["ag.metrics.unit.costs.total"] == "gen_ai.usage.cost"
