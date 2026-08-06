import sys

try:
    from agenta import _client as agenta_client
except ImportError:
    import agenta_client

sys.modules[__name__] = agenta_client
