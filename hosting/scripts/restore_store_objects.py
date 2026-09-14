#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["boto3>=1.34"]
# ///
"""Recover objects from a versioned Agenta object store.

Versioning turns a DELETE into a delete marker and an overwrite into a noncurrent version,
so a mass delete is reversible until the retention window closes. This is the tool that
reverses it.

Three things it does, against any S3-compatible endpoint (bundled SeaweedFS, MinIO, AWS S3):

  list             what versions and delete markers exist under a prefix, with timestamps
  --undelete       drop the delete markers created after a moment, so the last surviving
                   version of each key becomes current again
  --restore-as-of  copy back whatever version was current at a moment, as a new current
                   version, whether the key was later deleted or overwritten

Nothing is written without --apply. Examples:

  # what happened under this prefix?
  uv run hosting/scripts/restore_store_objects.py \\
      --endpoint-url http://localhost:8333 --bucket agenta-store --prefix mounts/abc/

  # undo a delete that happened this morning
  uv run hosting/scripts/restore_store_objects.py ... \\
      --undelete --since 2026-09-10T08:00:00Z --apply

  # put the prefix back the way it looked yesterday at 18:00 UTC
  uv run hosting/scripts/restore_store_objects.py ... \\
      --restore-as-of 2026-09-09T18:00:00Z --apply

Credentials come from --access-key/--secret-key, or from the usual AWS_ACCESS_KEY_ID /
AWS_SECRET_ACCESS_KEY environment variables.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError


@dataclass
class Entry:
    """One row of ListObjectVersions: a stored body, or a tombstone hiding one."""

    key: str
    version_id: str
    last_modified: datetime
    is_delete_marker: bool
    is_latest: bool
    size: int | None = None
    # Position in its own ListObjectVersions list, newest first. Stores commonly stamp
    # LastModified to the second, so several entries of one key can share a timestamp and
    # sorting on it alone would put the wrong one on top.
    rank: int = 0


@dataclass
class KeyHistory:
    key: str
    entries: list[Entry] = field(default_factory=list)

    def newest_first(self) -> list[Entry]:
        return sorted(
            self.entries,
            key=lambda e: (e.last_modified.timestamp(), e.is_latest, -e.rank),
            reverse=True,
        )

    def current(self) -> Entry:
        return self.newest_first()[0]

    def current_at(self, moment: datetime) -> Entry | None:
        """The entry that was current at `moment`, delete marker included, or None if the
        key did not exist yet."""
        for entry in self.newest_first():
            if entry.last_modified <= moment:
                return entry
        return None


def parse_moment(raw: str) -> datetime:
    value = raw.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"{raw!r} is not an ISO-8601 timestamp (e.g. 2026-09-10T08:00:00Z)"
        ) from exc
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def build_client(args: argparse.Namespace):
    return boto3.client(
        "s3",
        endpoint_url=args.endpoint_url,
        aws_access_key_id=args.access_key or os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=args.secret_key or os.getenv("AWS_SECRET_ACCESS_KEY"),
        region_name=args.region,
        # SeaweedFS and MinIO serve buckets as path segments, not DNS subdomains.
        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4"),
    )


def collect(client, bucket: str, prefix: str) -> dict[str, KeyHistory]:
    histories: dict[str, KeyHistory] = {}

    ranks: dict[tuple[str, bool], int] = {}

    def record(raw: dict, *, is_delete_marker: bool) -> None:
        history = histories.setdefault(raw["Key"], KeyHistory(key=raw["Key"]))
        slot = (raw["Key"], is_delete_marker)
        rank = ranks.get(slot, 0)
        ranks[slot] = rank + 1
        history.entries.append(
            Entry(
                key=raw["Key"],
                version_id=raw["VersionId"],
                last_modified=raw["LastModified"],
                is_delete_marker=is_delete_marker,
                is_latest=raw.get("IsLatest", False),
                size=raw.get("Size"),
                rank=rank,
            )
        )

    paginator = client.get_paginator("list_object_versions")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for raw in page.get("Versions", []):
            record(raw, is_delete_marker=False)
        for raw in page.get("DeleteMarkers", []):
            record(raw, is_delete_marker=True)
    return histories


def stamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def show(histories: dict[str, KeyHistory]) -> None:
    if not histories:
        print("No versions or delete markers under this prefix.")
        return
    deleted = 0
    for key in sorted(histories):
        history = histories[key]
        if history.current().is_delete_marker:
            deleted += 1
        print(f"\n{key}")
        for entry in history.newest_first():
            kind = "DELETE MARKER" if entry.is_delete_marker else f"{entry.size} bytes"
            marker = " <- current" if entry.is_latest else ""
            print(
                f"  {stamp(entry.last_modified)}  {entry.version_id:<40} {kind}{marker}"
            )
    print(
        f"\n{len(histories)} key(s); {deleted} currently deleted; "
        f"{sum(len(h.entries) for h in histories.values())} entries total."
    )


def undelete(
    client, bucket: str, histories: dict[str, KeyHistory], since: datetime, apply: bool
) -> int:
    """Remove delete markers created at or after `since`.

    Deleting a delete marker by version id is the documented way to bring back the object
    it hid; the newest surviving version under it becomes current again.
    """
    removed = 0
    for key in sorted(histories):
        for entry in histories[key].newest_first():
            if not entry.is_delete_marker or entry.last_modified < since:
                continue
            print(
                f"{'remove' if apply else 'would remove'} marker {stamp(entry.last_modified)}  {key}"
            )
            if apply:
                client.delete_object(Bucket=bucket, Key=key, VersionId=entry.version_id)
            removed += 1
    return removed


def restore_as_of(
    client, bucket: str, histories: dict[str, KeyHistory], moment: datetime, apply: bool
) -> int:
    """Copy the version that was current at `moment` back as a new current version."""
    restored = 0
    for key in sorted(histories):
        history = histories[key]
        wanted = history.current_at(moment)
        if wanted is None:
            print(f"skip (did not exist yet)        {key}")
            continue
        if wanted.is_delete_marker:
            print(f"skip (was deleted at that time) {key}")
            continue
        if wanted.is_latest:
            print(f"skip (already current)          {key}")
            continue
        print(
            f"{'restore' if apply else 'would restore'} {stamp(wanted.last_modified)} "
            f"({wanted.size} bytes)  {key}"
        )
        if apply:
            copy_version_to_current(client, bucket, key, wanted.version_id)
        restored += 1
    return restored


def copy_version_to_current(client, bucket: str, key: str, version_id: str) -> None:
    """Server-side copy when the store supports a versioned CopySource, byte round-trip
    otherwise — SeaweedFS has shipped both behaviours across releases."""
    try:
        client.copy_object(
            Bucket=bucket,
            Key=key,
            CopySource={"Bucket": bucket, "Key": key, "VersionId": version_id},
        )
        return
    except ClientError as exc:
        print(
            f"  server-side copy unavailable ({exc.response['Error'].get('Code')}); streaming instead"
        )
    body = client.get_object(Bucket=bucket, Key=key, VersionId=version_id)[
        "Body"
    ].read()
    client.put_object(Bucket=bucket, Key=key, Body=body)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="List, undelete, or roll back objects in a versioned Agenta store.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--endpoint-url", help="S3 endpoint; omit for AWS S3")
    parser.add_argument("--bucket", required=True)
    parser.add_argument(
        "--prefix",
        required=True,
        help="key prefix to act on; pass '' for the whole bucket",
    )
    parser.add_argument("--access-key", help="defaults to AWS_ACCESS_KEY_ID")
    parser.add_argument("--secret-key", help="defaults to AWS_SECRET_ACCESS_KEY")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument(
        "--undelete",
        action="store_true",
        help="remove delete markers created at or after --since",
    )
    parser.add_argument(
        "--since", type=parse_moment, help="ISO-8601, used with --undelete"
    )
    parser.add_argument(
        "--restore-as-of",
        type=parse_moment,
        help="ISO-8601; copy back the version current at that moment",
    )
    parser.add_argument(
        "--apply", action="store_true", help="write; without it, dry run"
    )
    args = parser.parse_args()

    if args.undelete and args.restore_as_of:
        parser.error("--undelete and --restore-as-of do different things; pick one")
    if args.undelete and not args.since:
        parser.error("--undelete needs --since")

    client = build_client(args)
    try:
        versioning = client.get_bucket_versioning(Bucket=args.bucket).get("Status")
    except ClientError as exc:
        print(f"Cannot read {args.bucket}: {exc}", file=sys.stderr)
        return 1
    if versioning != "Enabled":
        print(
            f"Bucket {args.bucket} reports versioning {versioning or 'Off'}. Anything "
            "deleted before versioning was turned on is not recoverable here.",
            file=sys.stderr,
        )

    histories = collect(client, args.bucket, args.prefix)

    if args.undelete:
        count = undelete(client, args.bucket, histories, args.since, args.apply)
        verb = "Removed" if args.apply else "Would remove"
        print(f"\n{verb} {count} delete marker(s).")
    elif args.restore_as_of:
        count = restore_as_of(
            client, args.bucket, histories, args.restore_as_of, args.apply
        )
        verb = "Restored" if args.apply else "Would restore"
        print(f"\n{verb} {count} object(s).")
    else:
        show(histories)
        return 0

    if not args.apply:
        print("Dry run. Re-run with --apply to write.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
