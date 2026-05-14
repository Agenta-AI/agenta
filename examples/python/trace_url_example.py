# /// script
# dependencies = [
#     "agenta",
# ]
# ///
"""
Minimal example showing how to build and print a trace URL with the Agenta SDK.

Steps:
1) Set AGENTA_API_KEY/AGENTA_HOST (or pass host/api_url/api_key to ag.init)
2) Run an instrumented function
3) Fetch the trace URL with ag.get_trace_url() or ag.tracing.get_trace_url(...)
"""

import os

import agenta as ag

# Configure Agenta credentials (replace with your values or rely on env vars)
os.environ["AGENTA_HOST"] = os.getenv(
    "AGENTA_HOST",
    "https://cloud.agenta.ai",
)
os.environ["AGENTA_API_KEY"] = os.getenv(
    "AGENTA_API_KEY",
    "your_agenta_api_key",
)


@ag.instrument()
def do_work(x: int, y: int) -> int:
    return x + y


def main() -> None:
    ag.init()

    result = do_work(2, 3)
    print(f"Result: {result}")

    # Fetch the trace URL for the current trace (uses active span context)
    trace_url = ag.get_trace_url()
    # or trace_url = ag.tracing.get_trace_url()
    print(f"Trace URL: {trace_url}")

    # You can also call directly on tracing if you want to pass a context provider explicitly:
    # trace_url = ag.tracing.get_trace_url(context_provider=ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.get_trace_context)


if __name__ == "__main__":
    main()
