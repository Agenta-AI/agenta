# /// script
# dependencies = ["pytest", "httpx", "opentelemetry-proto"]
# ///
import pytest
import httpx
import datetime
import time # For nanosecond conversion if datetime.timestamp() alone isn't precise enough
import secrets # For generating random hex strings for IDs
from datetime import timedelta # For adjusting timestamps
import copy # For deep copying span data templates

# OpenTelemetry Protobuf imports - adjust paths if your generated files are elsewhere
from opentelemetry.proto.trace.v1 import trace_pb2
from opentelemetry.proto.common.v1 import common_pb2
from opentelemetry.proto.resource.v1 import resource_pb2
from opentelemetry.proto.collector.trace.v1 import trace_service_pb2 # For TracesData

# --- Test Configuration ---
# Replace with your actual Agenta API URL and Key
AGENTA_API_URL = "http://localhost/api"  # Example: "https://your.agenta.host/api"
AGENTA_API_KEY = "Oh4jfy3n.6e76264498ea4057363ed780bac2beef45dcedc139af54f65dcc0d9e1076ce3b"    # Example: "ak_xxxxxxxxxxxxxxxxxxxx"

OTLP_ENDPOINT_PATH = "/otlp/v1/traces" 
# TEST_PROJECT_ID was here, removed as auth is via API Key primarily

# --- Base Span Data Definitions (Templates) ---
# These are templates; IDs and timestamps will be generated dynamically per test case.

# This was SPAN_2_LOG_DATA (parent span template)
BASE_PARENT_SPAN_DATA = {
    "name": 'main2',
    "kind_str": 'SPAN_KIND_SERVER',
    "status_code_str": 'STATUS_CODE_UNSET',
    "status_message": None,
    "attributes": {
        'ag.type.node': 'workflow',
        'ag.data.inputs.topic': 'df',
        'ag.data.inputs.genre': 'd',
        'ag.data.inputs.count': 1,
        'ag.data.internals.topic': 'df',
        'ag.data.internals.genre': 'd',
        'ag.data.internals.count': 1,
        'ag.meta.topic': 'df',
        'ag.meta.genre': 'd',
        'ag.meta.count': 1,
        'ag.refs.environment.slug': 'production',
        'ag.data.outputs.__default__': "('df', 'd', 1)"
    },
    # Dynamic fields to be added: trace_id_hex, span_id_hex, parent_span_id_hex (None for root), start_time, end_time
}

# This was SPAN_1_LOG_DATA (child span template)
BASE_CHILD_SPAN_DATA = {
    "name": 'llm_function',
    "kind_str": 'SPAN_KIND_CLIENT',
    "status_code_str": 'STATUS_CODE_UNSET',
    "status_message": None,
    "attributes": {
        'ag.type.node': 'chat',
        'ag.data.inputs.topic': 'df',
        'ag.data.inputs.genre': 'd',
        'ag.data.inputs.count': 1,
        'ag.data.internals.topic2': 'df',
        'ag.data.internals.genre2': 'd',
        'ag.data.internals.count2': 1,
        'ag.data.outputs.__default__': "('df', 'd', 1)"
    },
    # Dynamic fields to be added: trace_id_hex, span_id_hex, parent_span_id_hex, start_time, end_time
}

# --- Test Scenarios Definition ---
TEST_SCENARIOS = [
    {
        "name": "basic_parent_child",
        "description": "A simple trace with one parent span and one child span.",
        "parent_template": BASE_PARENT_SPAN_DATA,
        "child_template": BASE_CHILD_SPAN_DATA, # Child is present for this scenario
    },
    # Example of a future single-span scenario:
    # {
    #     "name": "single_root_span",
    #     "description": "A trace with only a single root span.",
    #     "parent_template": BASE_PARENT_SPAN_DATA, 
    #     "child_template": None, # No child for this scenario
    # },
]

# --- Helper Functions ---
def _datetime_to_unix_nano(dt: datetime.datetime) -> int:
    """Converts a datetime object to UNIX nanoseconds."""
    return int(dt.timestamp() * 1_000_000_000)

def _hex_to_bytes(hex_str: str) -> bytes:
    """Converts a hex string (optionally prefixed with 0x) to bytes."""
    if hex_str.startswith('0x'):
        return bytes.fromhex(hex_str[2:])
    return bytes.fromhex(hex_str)

def _create_any_value(value) -> common_pb2.AnyValue:
    """Creates an AnyValue protobuf message from a Python value."""
    if isinstance(value, str):
        return common_pb2.AnyValue(string_value=value)
    elif isinstance(value, bool):
        return common_pb2.AnyValue(bool_value=value)
    elif isinstance(value, int):
        return common_pb2.AnyValue(int_value=value)
    elif isinstance(value, float):
        return common_pb2.AnyValue(double_value=value)
    # Add other types (array, kvlist) if needed
    else:
        # For testing, convert unknown types to string representation
        # In a real scenario, you might want to raise an error or handle more types
        return common_pb2.AnyValue(string_value=str(value))

def convert_span_data_to_proto(span_data: dict) -> trace_pb2.Span:
    """Converts a Python dictionary with span data to an OTLP Span protobuf object."""
    
    attributes_proto = []
    if span_data.get("attributes"):
        for k, v in span_data["attributes"].items():
            attributes_proto.append(common_pb2.KeyValue(key=k, value=_create_any_value(v)))

    status_proto = trace_pb2.Status(
        code=trace_pb2.Status.StatusCode.Value(span_data["status_code_str"])
    )
    if span_data.get("status_message"):
        status_proto.message = span_data["status_message"]

    parent_span_id_bytes = b''
    if span_data.get("parent_span_id_hex"):
        parent_span_id_bytes = _hex_to_bytes(span_data["parent_span_id_hex"])

    return trace_pb2.Span(
        trace_id=_hex_to_bytes(span_data["trace_id_hex"]),
        span_id=_hex_to_bytes(span_data["span_id_hex"]),
        parent_span_id=parent_span_id_bytes,
        name=span_data["name"],
        kind=trace_pb2.Span.SpanKind.Value(span_data["kind_str"]),
        start_time_unix_nano=_datetime_to_unix_nano(span_data["start_time"]),
        end_time_unix_nano=_datetime_to_unix_nano(span_data["end_time"]),
        attributes=attributes_proto,
        status=status_proto,
        # events and links can be added here if needed
    )

# --- Pytest Test Case (Parametrized) ---
@pytest.mark.parametrize("scenario", TEST_SCENARIOS, ids=[s["name"] for s in TEST_SCENARIOS])
@pytest.mark.asyncio
async def test_send_spans_to_otlp_endpoint(scenario):
    """Tests sending spans defined in a scenario to the OTLP ingestion endpoint."""
    print(f"\nRunning test scenario: {scenario['name']} - {scenario['description']}")

    parent_log_data_template = scenario["parent_template"]
    child_log_data_template = scenario.get("child_template") # Use .get() for future scenarios

    # --- Generate dynamic IDs and Timestamps ---
    now = datetime.datetime.now(datetime.timezone.utc)
    dynamic_trace_id_hex = secrets.token_hex(16)
    parent_span_id_hex = secrets.token_hex(8)
    
    processed_spans_proto = []

    # Process Parent Span
    parent_start_time = now
    # Default parent end time; will be adjusted if child needs to fit
    parent_end_time = parent_start_time + timedelta(microseconds=300) 

    dynamic_parent_data = copy.deepcopy(parent_log_data_template)
    dynamic_parent_data.update({
        "trace_id_hex": dynamic_trace_id_hex,
        "span_id_hex": parent_span_id_hex,
        "parent_span_id_hex": None, # Parent is root
        "start_time": parent_start_time,
        # End time will be finalized after potential child processing
    })

    # Process Child Span (if it exists in the scenario)
    if child_log_data_template:
        child_span_id_hex = secrets.token_hex(8)
        child_start_time = parent_start_time + timedelta(microseconds=100)
        child_end_time = child_start_time + timedelta(microseconds=100) # Child duration
        
        # Adjust parent's end time to ensure it encompasses the child
        parent_end_time = max(parent_end_time, child_end_time + timedelta(microseconds=50))

        dynamic_child_data = copy.deepcopy(child_log_data_template)
        dynamic_child_data.update({
            "trace_id_hex": dynamic_trace_id_hex,
            "span_id_hex": child_span_id_hex,
            "parent_span_id_hex": parent_span_id_hex, # Link to parent
            "start_time": child_start_time,
            "end_time": child_end_time,
        })
        span_proto_child = convert_span_data_to_proto(dynamic_child_data)
        processed_spans_proto.append(span_proto_child)

    # Finalize parent's end time and create its proto
    dynamic_parent_data["end_time"] = parent_end_time
    span_proto_parent = convert_span_data_to_proto(dynamic_parent_data)
    
    # Ensure parent is first if both exist, then child. If only parent, just parent.
    if child_log_data_template:
        final_spans_for_otlp = [span_proto_parent, processed_spans_proto[0]] # Assuming child was added
    else:
        final_spans_for_otlp = [span_proto_parent]

    # Create TracesData structure
    traces_data = trace_pb2.TracesData(
        resource_spans=[
            trace_pb2.ResourceSpans(
                resource=resource_pb2.Resource(
                    attributes=[
                        common_pb2.KeyValue(
                            key="service.name", 
                            value=common_pb2.AnyValue(string_value="pytest-otel-sender")
                        )
                    ]
                ),
                scope_spans=[
                    trace_pb2.ScopeSpans(
                        scope=common_pb2.InstrumentationScope(name="test_scope"),
                        spans=final_spans_for_otlp
                    )
                ]
            )
        ]
    )

    otlp_payload = traces_data.SerializeToString()
    headers = {
        "Content-Type": "application/x-protobuf",
        "Authorization": f"ApiKey {AGENTA_API_KEY}"
    }
    full_otlp_endpoint = f"{AGENTA_API_URL.rstrip('/')}{OTLP_ENDPOINT_PATH}"

    async with httpx.AsyncClient() as client:
        response = await client.post(full_otlp_endpoint, content=otlp_payload, headers=headers)

    assert response.status_code == 202, f"Request failed: {response.status_code} - {response.text}"
    
    response_json = response.json()
    assert response_json.get("status") == "processing", f"Unexpected status: {response_json.get('status')}"
    assert "version" in response_json, "Version missing in response"

    print(f"Successfully sent OTLP data for scenario '{scenario['name']}'. Response: {response_json}")

# To run this test:
# 1. Ensure Agenta backend is running locally (e.g., `docker-compose up agenta-backend`).
# 2. Install dependencies: `pip install pytest httpx opentelemetry-proto`
# 3. Set TEST_PROJECT_ID at the top of this file if your backend requires a specific one for manual testing.
#    Alternatively, ensure your middleware handles a dummy ID gracefully or set up a test project.
# 4. Run pytest from the root of the `agenta_cloud` repository:
#    `pytest api/oss/tests/manual/tracing/test_otlp_ingestion.py`
