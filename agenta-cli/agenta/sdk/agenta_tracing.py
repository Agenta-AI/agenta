from typing import Optional, Dict, Any


class LLMTracing:
    def __init__(self, base_url, api_key):
        raise NotImplementedError

    def start_trace(self, app_id: str, variant_id: str, **kwargs: Dict[str, Any]):
        raise NotImplementedError

    def create_span(self, parent_trace_id: Optional[str], event_name: str):
        raise NotImplementedError

    def set_pan_tag(self, key: str, value: str):
        raise NotImplementedError
