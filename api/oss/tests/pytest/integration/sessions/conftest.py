"""What this layer needs before any of its cases can mean anything: two databases.

Both are on the deployment's one Postgres server, and the suite reaches them from the host
through its published port. They are resolved separately because they are configured
separately: the session query and claim cases build on `get_transactions_engine()`, which
reads the core URI, and the record sequence, snapshot and replay cases build on
`get_analytics_engine()`, which reads the tracing URI. Only core used to be resolved here, so
the seven analytics cases dialled the in-network host name from the host and ended in

    socket.gaierror: [Errno -3] Temporary failure in name resolution

which reads as a broken environment rather than as an address nobody rewrote. Exporting the
two Redis addresses, which the runbook named as this layer's precondition, changes none of it.
"""

import pytest

from oss.tests.pytest.utils.postgres import (
    use_reachable_core_uri,
    use_reachable_tracing_uri,
)


@pytest.fixture(autouse=True)
def _skip_when_postgres_unreachable(request):
    """Resolve both addresses before any engine is built, and before any case runs.

    The engines are module-level singletons the record files reset per test, so they are
    built after this fixture and read what it installed.
    """
    if not request.node.get_closest_marker("integration"):
        return

    if use_reachable_core_uri() is None or use_reachable_tracing_uri() is None:
        pytest.skip("Postgres not reachable — skipping session DAO integration tests")
