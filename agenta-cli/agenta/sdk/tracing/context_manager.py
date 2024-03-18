# Own Imports
from agenta.sdk.tracing.llm_tracing import Tracing


class TracingContextManager:
    def __init__(self, tracing: Tracing):
        ...

    def __enter__(self):
        ...

    def __exit__(self, exc_type, exc_val, exc_tb):
        ...
