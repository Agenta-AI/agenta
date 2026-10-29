"""Recovery safety tests. Run with uv run --with boto3 --with pytest pytest hosting/scripts/tests."""

import importlib.util
import io
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError

spec = importlib.util.spec_from_file_location(
    "restore_store_objects", Path(__file__).parents[1] / "restore_store_objects.py"
)
restore = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = restore
spec.loader.exec_module(restore)


@pytest.mark.parametrize(
    "endpoint",
    [
        None,
        "https://store.example",
        "http://localhost:8333",
        "http://127.0.0.1:8333",
        "http://[::1]:8333",
    ],
)
def test_secure_and_loopback_endpoints(endpoint):
    restore.validate_endpoint(endpoint, False)


@pytest.mark.parametrize(
    "endpoint", ["http://store.example", "http://10.0.0.1", "http://localhost.example"]
)
def test_remote_http_requires_opt_in(endpoint):
    with pytest.raises(ValueError, match="allow-insecure"):
        restore.validate_endpoint(endpoint, False)
    restore.validate_endpoint(endpoint, True)


def test_invalid_endpoint_is_rejected():
    with pytest.raises(ValueError):
        restore.validate_endpoint("file:///tmp/store", True)


def history(key, *, ambiguous=False, latest=False):
    moment = datetime(2026, 9, 10, tzinfo=timezone.utc)
    entries = [restore.Entry(key, "body", moment, False, latest, 10)]
    if ambiguous:
        entries.append(restore.Entry(key, "marker", moment, True, False))
    return restore.KeyHistory(key, entries), moment


def test_ambiguous_history_is_rejected_before_any_write():
    good, moment = history("a")
    ambiguous, _ = history("z", ambiguous=True)
    client = Mock()
    with pytest.raises(ValueError, match="Ambiguous"):
        restore.restore_as_of(
            client, "bucket", {"a": good, "z": ambiguous}, moment, True
        )
    assert client.mock_calls == []


def test_latest_flag_resolves_cross_type_tie():
    item, moment = history("key", ambiguous=True, latest=True)
    assert item.current_at(moment).version_id == "body"


def test_older_ambiguity_does_not_block_unambiguous_selection():
    item, moment = history("key", ambiguous=True)
    later = moment + timedelta(seconds=1)
    item.entries.append(restore.Entry("key", "later", later, False, False, 20))
    assert item.current_at(later).version_id == "later"


def test_collect_preserves_same_type_order_across_pages():
    moment = datetime(2026, 9, 10, tzinfo=timezone.utc)
    client = Mock()
    client.get_paginator.return_value.paginate.return_value = [
        {"Versions": [{"Key": "key", "VersionId": version, "LastModified": moment}]}
        for version in ["newer", "older"]
    ]
    assert (
        restore.collect(client, "bucket", "")["key"].current_at(moment).version_id
        == "newer"
    )


@pytest.mark.parametrize("upload_fails", [False, True])
def test_fallback_streams_and_closes_body(upload_fails):
    client = Mock()
    client.copy_object.side_effect = ClientError(
        {"Error": {"Code": "NotImplemented"}}, "CopyObject"
    )
    body = io.BytesIO(b"recovered")
    client.get_object.return_value = {"Body": body}

    def upload(stream, bucket, key, *, Config):
        assert stream is body
        assert not stream.closed
        assert (bucket, key) == ("bucket", "key")
        assert Config.use_threads is False
        assert Config.multipart_chunksize == 8 * 1024 * 1024
        if upload_fails:
            raise RuntimeError("upload failed")
        assert stream.read(9) == b"recovered"

    client.upload_fileobj.side_effect = upload
    if upload_fails:
        with pytest.raises(RuntimeError):
            restore.copy_version_to_current(client, "bucket", "key", "old")
    else:
        restore.copy_version_to_current(client, "bucket", "key", "old")
    assert body.closed
    client.get_object.assert_called_once_with(
        Bucket="bucket", Key="key", VersionId="old"
    )
    client.put_object.assert_not_called()


@pytest.mark.parametrize("status", [None, "Suspended", "Enabled"])
@pytest.mark.parametrize(
    "mode",
    [[], ["--undelete", "--since", "2026-09-10"], ["--restore-as-of", "2026-09-10"]],
)
@pytest.mark.parametrize("apply", [False, True])
def test_main_requires_versioning_only_for_writes(monkeypatch, status, mode, apply):
    client = Mock()
    client.get_bucket_versioning.return_value = {"Status": status}
    monkeypatch.setattr(restore, "build_client", lambda args: client)
    collect = Mock(return_value={})
    monkeypatch.setattr(restore, "collect", collect)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "restore",
            "--bucket",
            "bucket",
            "--prefix",
            "prefix",
            *mode,
            *(["--apply"] if apply else []),
        ],
    )
    blocked = status != "Enabled" and mode and apply
    assert restore.main() == (1 if blocked else 0)
    assert collect.called == (not blocked)
