"""What this layer needs before any of its cases can mean anything: two databases, and proof.

Both are on the deployment's one Postgres server, reached from the host through its published
port, and they are resolved separately because they are configured separately: the session
query and claim cases build on `get_transactions_engine()`, which reads the core URI, and the
record sequence, snapshot and replay cases build on `get_analytics_engine()`, which reads the
tracing URI. Only core used to be resolved here, so those seven cases dialled the in-network
host name from the host and ended in

    socket.gaierror: [Errno -3] Temporary failure in name resolution

which reads as a broken environment rather than as an address nobody rewrote. Exporting the
two Redis addresses, which the runbook named as this layer's precondition, changes none of it.

The guard itself is the shared one in `utils/deployment.py`, so this layer refuses a database
belonging to another deployment the same way the gateway layer does (D141). Only the three
statements that are this layer's own are made here.
"""

import pytest

from oss.tests.pytest.utils.deployment import (  # noqa: F401
    the_deployment_under_test,
)


@pytest.fixture
def deployment_databases():
    return ("core", "tracing")


@pytest.fixture
def deployment_absence():
    """Still a skip, which is its own finding and not this one's to close.

    A database this layer cannot reach leaves it reporting a green run of nothing, the way
    the gateway layer used to (D97, D121). Identity is not affected: a database that answers
    and belongs to somebody else fails here, and always did not.
    """
    return "skip"


@pytest.fixture
def deployment_applies(request):
    return request.node.get_closest_marker("integration") is not None
