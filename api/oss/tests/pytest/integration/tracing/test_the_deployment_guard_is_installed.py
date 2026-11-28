"""This layer runs the guard that keeps it off another deployment's database.

One assertion, because the wiring it protects is one import in this directory's conftest, and
that import carries a lint suppression: nothing else in the file uses the name, so deleting it
breaks nothing and `ruff --fix` would take it out as unused (D163).
"""

from oss.tests.pytest.utils.deployment import assert_the_guard_is_installed


def test_the_deployment_guard_reaches_every_case_in_this_layer(request):
    assert_the_guard_is_installed(request)
