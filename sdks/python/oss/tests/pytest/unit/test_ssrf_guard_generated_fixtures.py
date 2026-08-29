"""Regenerate-and-compare: the SSRF-guard range tables and vector fixture must match what
`ssrf_guard_vectors.py` produces right now. A drift here means someone hand-edited the
committed JSON, or Python's `ipaddress` special registries changed underneath us — either
way, `services/runner/src/tools/ssrf-guard.ts` and `agenta.sdk.utils.net` are tested against
a stale ground truth until the fixtures are regenerated.
"""

import ipaddress
import json

from agenta.sdk.utils import net

from oss.tests.pytest.utils.ssrf_guard_vectors import (
    RANGES_PATH,
    VECTORS_PATH,
    generate_ranges,
    generate_vectors,
)


def test_generated_ranges_match_committed_fixture():
    committed = json.loads(RANGES_PATH.read_text())
    assert committed == generate_ranges()


def test_generated_vectors_match_committed_fixture():
    committed = json.loads(VECTORS_PATH.read_text())
    assert committed == generate_vectors()


def test_net_py_agrees_with_every_vector():
    for vector in generate_vectors():
        ip = ipaddress.ip_address(vector["host"])
        assert net._is_blocked_ip(ip, allow_insecure=False) == vector["blocked"], (
            vector["host"]
        )
