"""Admin membership writes clear the access caches after their commit; a failure there
must not raise, because some callers undo other work (deletion tombstones) on error."""

from uuid import uuid4

import oss.src.core.accounts.service as accounts_module


async def test_a_failed_project_lookup_does_not_raise(monkeypatch):
    warnings = []

    async def _failing_lookup(organization_ids):
        raise RuntimeError("database down")

    class _Log:
        def warning(self, event, **fields):
            warnings.append(event)

    monkeypatch.setattr(
        accounts_module, "_db_get_project_ids_for_orgs", _failing_lookup
    )
    monkeypatch.setattr(accounts_module, "log", _Log())

    await accounts_module._invalidate_memberships(
        user_ids=[uuid4()], organization_ids=[uuid4()]
    )

    assert warnings == ["[admin] access cache invalidation failed"]
