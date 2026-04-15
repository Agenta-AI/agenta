"""
Auth-guard tests for every platform-admin endpoint.

All /admin/* routes must reject requests that carry no
Authorization header (or a wrong one) with 401.
"""

import pytest


_ADMIN_ENDPOINTS = [
    ("POST", "/admin/accounts/"),
    ("DELETE", "/admin/accounts/"),
    ("POST", "/admin/simple/accounts/"),
    ("DELETE", "/admin/simple/accounts/"),
    ("POST", "/admin/simple/accounts/users/"),
    ("POST", "/admin/simple/accounts/users/identities/"),
    (
        "DELETE",
        "/admin/simple/accounts/users/00000000-0000-0000-0000-000000000001/identities/00000000-0000-0000-0000-000000000002/",
    ),
    ("POST", "/admin/simple/accounts/organizations/"),
    (
        "DELETE",
        "/admin/simple/accounts/organizations/00000000-0000-0000-0000-000000000001/",
    ),
    ("POST", "/admin/simple/accounts/organizations/memberships/"),
    (
        "DELETE",
        "/admin/simple/accounts/organizations/00000000-0000-0000-0000-000000000001/memberships/00000000-0000-0000-0000-000000000002/",
    ),
    ("POST", "/admin/simple/accounts/workspaces/"),
    (
        "DELETE",
        "/admin/simple/accounts/workspaces/00000000-0000-0000-0000-000000000001/",
    ),
    ("POST", "/admin/simple/accounts/workspaces/memberships/"),
    (
        "DELETE",
        "/admin/simple/accounts/workspaces/00000000-0000-0000-0000-000000000001/memberships/00000000-0000-0000-0000-000000000002/",
    ),
    ("POST", "/admin/simple/accounts/projects/"),
    ("DELETE", "/admin/simple/accounts/projects/00000000-0000-0000-0000-000000000001/"),
    ("POST", "/admin/simple/accounts/projects/memberships/"),
    (
        "DELETE",
        "/admin/simple/accounts/projects/00000000-0000-0000-0000-000000000001/memberships/00000000-0000-0000-0000-000000000002/",
    ),
    ("POST", "/admin/simple/accounts/api-keys/"),
    ("DELETE", "/admin/simple/accounts/api-keys/00000000-0000-0000-0000-000000000001/"),
    ("POST", "/admin/simple/accounts/reset-password"),
    ("POST", "/admin/simple/accounts/transfer-ownership"),
]


@pytest.mark.parametrize("method,endpoint", _ADMIN_ENDPOINTS)
class TestAdminAuthRequired:
    def test_no_auth_header_returns_401(self, unauthed_api, method, endpoint):
        response = unauthed_api(method, endpoint, json={})
        assert response.status_code == 401

    def test_wrong_auth_scheme_returns_401(self, unauthed_api, method, endpoint):
        response = unauthed_api(
            method,
            endpoint,
            json={},
            headers={"Authorization": "Bearer not-a-valid-token"},
        )
        assert response.status_code == 401

    def test_wrong_access_key_returns_401(self, unauthed_api, method, endpoint):
        response = unauthed_api(
            method,
            endpoint,
            json={},
            headers={"Authorization": "Access definitely-wrong-key"},
        )
        assert response.status_code == 401
