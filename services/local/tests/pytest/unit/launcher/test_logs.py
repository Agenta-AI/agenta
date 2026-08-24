from datetime import datetime, timedelta, timezone

from agenta_local.launcher.logs import LogManager


def test_logs_use_private_permissions_timestamped_path_and_rotation(tmp_path):
    now = datetime(2026, 8, 24, 12, 0, tzinfo=timezone.utc)
    ticks = iter(now + timedelta(seconds=index) for index in range(4))
    manager = LogManager(
        tmp_path / "state with spaces/logs", retain=2, clock=lambda: next(ticks)
    )

    paths = []
    for _ in range(4):
        log = manager.open("runner")
        log.stream.write(b"safe output\n")
        paths.append(log.path)
        log.close()

    remaining = sorted(manager.directory.glob("runner-*.log"))
    assert len(remaining) == 2
    assert paths[-1] in remaining
    assert manager.directory.stat().st_mode & 0o777 == 0o700
    assert all(path.stat().st_mode & 0o777 == 0o600 for path in remaining)
    assert all("20260824T12000" in path.name for path in remaining)
