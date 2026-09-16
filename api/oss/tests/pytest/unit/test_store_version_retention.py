"""Unit tests for bundled-store version retention.

`ObjectStore.ensure_version_retention` runs on every API boot, so the contract under test
is: turn versioning on and install one noncurrent-expiration rule, write nothing when the
bucket already matches, never touch a remote S3 bucket, and never drop an operator's own
lifecycle rules.

The fake below implements the four miniopy-async bucket calls the method uses; the real
adapter is a thin pass-through to them.
"""

from typing import List, Optional

import pytest

from miniopy_async.commonconfig import ENABLED, Filter
from miniopy_async.lifecycleconfig import (
    LifecycleConfig,
    NoncurrentVersionExpiration,
    Rule,
)
from miniopy_async.versioningconfig import VersioningConfig

from oss.src.core.store.storage import ObjectStore, _RETENTION_RULE_ID
from oss.src.utils.env import _store_version_retention_days_default


class FakeBucketClient:
    """Records bucket-level versioning/lifecycle calls made by the adapter."""

    def __init__(
        self,
        *,
        versioning_status: Optional[str] = None,
        lifecycle: Optional[LifecycleConfig] = None,
    ):
        self.versioning = VersioningConfig(versioning_status)
        self.lifecycle = lifecycle
        self.versioning_writes: List[str] = []
        self.lifecycle_writes: List[LifecycleConfig] = []
        self.lifecycle_deletes = 0

    async def get_bucket_versioning(self, bucket_name: str) -> VersioningConfig:
        return self.versioning

    async def set_bucket_versioning(self, bucket_name: str, config: VersioningConfig):
        self.versioning = config
        self.versioning_writes.append(config.status)

    async def get_bucket_lifecycle(self, bucket_name: str) -> Optional[LifecycleConfig]:
        return self.lifecycle

    async def set_bucket_lifecycle(self, bucket_name: str, config: LifecycleConfig):
        self.lifecycle = config
        self.lifecycle_writes.append(config)

    async def delete_bucket_lifecycle(self, bucket_name: str):
        self.lifecycle = None
        self.lifecycle_deletes += 1


def _store(
    monkeypatch, client: FakeBucketClient, *, signing_key="sts-key"
) -> ObjectStore:
    store = ObjectStore(
        endpoint_url="http://seaweedfs:8333",
        access_key="key",
        secret_key="secret",
        signing_key=signing_key,
    )
    monkeypatch.setattr(store, "_client", lambda: client)
    return store


def _retention_rule(days: int, status: str = ENABLED) -> Rule:
    return Rule(
        status,
        rule_id=_RETENTION_RULE_ID,
        rule_filter=Filter(prefix=""),
        noncurrent_version_expiration=NoncurrentVersionExpiration(noncurrent_days=days),
    )


def _rule_ids(config: LifecycleConfig) -> List[str]:
    return [rule.rule_id for rule in config.rules]


class TestEnsureVersionRetention:
    @pytest.mark.asyncio
    async def test_enables_versioning_and_installs_rule(self, monkeypatch):
        client = FakeBucketClient()
        store = _store(monkeypatch, client)

        applied = await store.ensure_version_retention(
            bucket="agenta-store", retention_days=30
        )

        assert applied is True
        assert client.versioning_writes == [ENABLED]
        assert len(client.lifecycle_writes) == 1
        rule = client.lifecycle_writes[0].rules[0]
        assert rule.rule_id == _RETENTION_RULE_ID
        assert rule.status == ENABLED
        assert rule.noncurrent_version_expiration.noncurrent_days == 30

    @pytest.mark.asyncio
    async def test_second_boot_writes_nothing(self, monkeypatch):
        client = FakeBucketClient(
            versioning_status=ENABLED,
            lifecycle=LifecycleConfig([_retention_rule(30)]),
        )
        store = _store(monkeypatch, client)

        applied = await store.ensure_version_retention(
            bucket="agenta-store", retention_days=30
        )

        assert applied is True
        assert client.versioning_writes == []
        assert client.lifecycle_writes == []

    @pytest.mark.asyncio
    async def test_changed_retention_days_rewrites_the_rule(self, monkeypatch):
        client = FakeBucketClient(
            versioning_status=ENABLED,
            lifecycle=LifecycleConfig([_retention_rule(30)]),
        )
        store = _store(monkeypatch, client)

        await store.ensure_version_retention(bucket="agenta-store", retention_days=7)

        assert client.versioning_writes == []
        written = client.lifecycle_writes[0]
        assert _rule_ids(written) == [_RETENTION_RULE_ID]
        assert written.rules[0].noncurrent_version_expiration.noncurrent_days == 7

    @pytest.mark.asyncio
    async def test_keeps_operator_rules(self, monkeypatch):
        operator_rule = Rule(
            ENABLED,
            rule_id="operator-owned",
            rule_filter=Filter(prefix="scratch/"),
            noncurrent_version_expiration=NoncurrentVersionExpiration(
                noncurrent_days=1
            ),
        )
        client = FakeBucketClient(
            versioning_status=ENABLED,
            lifecycle=LifecycleConfig([operator_rule]),
        )
        store = _store(monkeypatch, client)

        await store.ensure_version_retention(bucket="agenta-store", retention_days=30)

        assert _rule_ids(client.lifecycle_writes[0]) == [
            "operator-owned",
            _RETENTION_RULE_ID,
        ]

    @pytest.mark.asyncio
    async def test_remote_s3_is_left_alone(self, monkeypatch):
        client = FakeBucketClient()
        store = _store(monkeypatch, client, signing_key=None)

        applied = await store.ensure_version_retention(
            bucket="agenta-store", retention_days=30
        )

        assert applied is False
        assert client.versioning_writes == []
        assert client.lifecycle_writes == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("retention_days", [0, -1])
    async def test_zero_or_negative_days_disables_the_feature(
        self, monkeypatch, retention_days
    ):
        client = FakeBucketClient()
        store = _store(monkeypatch, client)

        applied = await store.ensure_version_retention(
            bucket="agenta-store", retention_days=retention_days
        )

        assert applied is False
        assert client.versioning_writes == []
        assert client.lifecycle_writes == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("operator_rule_present", [False, True])
    async def test_zero_removes_owned_rule_and_preserves_versioning(
        self, monkeypatch, operator_rule_present
    ):
        operator_rule = Rule(
            ENABLED,
            rule_id="operator-owned",
            rule_filter=Filter(prefix="scratch/"),
            noncurrent_version_expiration=NoncurrentVersionExpiration(
                noncurrent_days=7
            ),
        )
        rules = [_retention_rule(30)]
        if operator_rule_present:
            rules.append(operator_rule)
        client = FakeBucketClient(
            versioning_status=ENABLED, lifecycle=LifecycleConfig(rules)
        )
        store = _store(monkeypatch, client)

        assert (
            await store.ensure_version_retention(
                bucket="agenta-store", retention_days=0
            )
            is False
        )
        assert client.versioning.status == ENABLED
        assert client.versioning_writes == []
        if operator_rule_present:
            assert client.lifecycle.rules == [operator_rule]
            assert client.lifecycle_deletes == 0
        else:
            assert client.lifecycle is None
            assert client.lifecycle_deletes == 1
        writes = len(client.lifecycle_writes)
        deletes = client.lifecycle_deletes
        await store.ensure_version_retention(bucket="agenta-store", retention_days=0)
        assert len(client.lifecycle_writes) == writes
        assert client.lifecycle_deletes == deletes

    @pytest.mark.asyncio
    async def test_store_without_credentials_is_a_no_op(self, monkeypatch):
        client = FakeBucketClient()
        store = ObjectStore(
            endpoint_url="http://seaweedfs:8333",
            access_key=None,
            secret_key=None,
            signing_key="sts-key",
        )
        monkeypatch.setattr(store, "_client", lambda: client)

        assert (
            await store.ensure_version_retention(
                bucket="agenta-store", retention_days=30
            )
            is False
        )
        assert client.versioning_writes == []


class TestRetentionDaysEnv:
    def test_defaults_to_thirty_days(self, monkeypatch):
        monkeypatch.delenv("AGENTA_STORE_VERSION_RETENTION_DAYS", raising=False)
        assert _store_version_retention_days_default() == 30

    @pytest.mark.parametrize("raw,expected", [("7", 7), ("0", 0), (" 90 ", 90)])
    def test_reads_the_override(self, monkeypatch, raw, expected):
        monkeypatch.setenv("AGENTA_STORE_VERSION_RETENTION_DAYS", raw)
        assert _store_version_retention_days_default() == expected

    @pytest.mark.parametrize("raw", ["-1", "forever"])
    def test_rejects_invalid_values(self, monkeypatch, raw):
        monkeypatch.setenv("AGENTA_STORE_VERSION_RETENTION_DAYS", raw)
        with pytest.raises(ValueError):
            _store_version_retention_days_default()
