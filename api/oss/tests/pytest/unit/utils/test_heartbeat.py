"""Unit coverage for the worker heartbeat.

The heartbeat is what a liveness probe reads, so these tests care about the two ways it
can hurt a running deployment:

* writing when nobody asked. Every existing install has the variable unset, and a file
  appearing there would be a surprise. Worse, a probe pointed at a path the application
  never writes restarts a healthy pod every few minutes.
* raising into the caller. A full disk or a read-only filesystem must not kill a worker
  loop. A heartbeat that cannot be written has to show up as a stale file, which is the
  signal the probe already handles.

The freshness arithmetic itself lives in the probe's shell command, not here, so it is
pinned by the chart test instead.
"""

from __future__ import annotations


import pytest

from oss.src.utils import heartbeat


@pytest.fixture(autouse=True)
def _reset_warning_latch():
    """The module warns once; reset it so each test sees the same starting state."""
    heartbeat._WARNED = False
    yield
    heartbeat._WARNED = False


def _configure(monkeypatch, value):
    monkeypatch.setattr(
        type(heartbeat.env.agenta.workers), "heartbeat_file", value, raising=False
    )
    monkeypatch.setattr(heartbeat.env.agenta.workers, "heartbeat_file", value)


def test_does_nothing_when_unconfigured(monkeypatch, tmp_path):
    """The default is off, and off must mean no file and no error."""
    _configure(monkeypatch, "")
    assert heartbeat.directory() is None
    assert heartbeat.path("spans") is None
    assert heartbeat.touch(name="spans") is False
    assert heartbeat.age_seconds(name="spans") is None
    assert list(tmp_path.iterdir()) == []


def test_blank_configuration_is_also_off(monkeypatch):
    """Whitespace is what a values file produces when someone clears the setting."""
    _configure(monkeypatch, "   ")
    assert heartbeat.directory() is None
    assert heartbeat.touch(name="spans") is False


def test_writes_a_readable_timestamp(monkeypatch, tmp_path):
    _configure(monkeypatch, str(tmp_path))

    assert heartbeat.touch(name="spans", now=1_000_000) is True
    assert (tmp_path / "spans").read_text().strip() == "1000000"
    assert heartbeat.age_seconds(name="spans", now=1_000_030) == pytest.approx(30)


def test_each_loop_gets_its_own_file(monkeypatch, tmp_path):
    """The reason this exists: several consumer loops share one process.

    A shared file let a healthy loop keep the probe passing while another loop was
    stalled, which is the failure the probe is for.
    """
    _configure(monkeypatch, str(tmp_path))

    heartbeat.touch(name="spans", now=1_000_000)
    heartbeat.touch(name="records", now=1_000_000)
    heartbeat.touch(name="records", now=1_000_500)

    assert sorted(p.name for p in tmp_path.iterdir()) == ["records", "spans"]
    assert heartbeat.age_seconds(name="spans", now=1_000_500) == pytest.approx(500)
    assert heartbeat.age_seconds(name="records", now=1_000_500) == pytest.approx(0)


def test_a_name_cannot_escape_the_directory(monkeypatch, tmp_path):
    """Names come from stream names, so a separator must not write elsewhere."""
    _configure(monkeypatch, str(tmp_path))

    for hostile in ("../escape", "a/b", "with space", "", "///"):
        assert heartbeat.touch(name=hostile, now=5) is True

    for written in tmp_path.iterdir():
        assert written.parent == tmp_path, f"{written} escaped the directory"
        assert "/" not in written.name and " " not in written.name


def test_creates_the_directory_it_needs(monkeypatch, tmp_path):
    """A configured directory the image does not ship must still work."""
    target = tmp_path / "nested" / "deeper"
    _configure(monkeypatch, str(target))

    assert heartbeat.touch(name="spans", now=5) is True
    assert (target / "spans").read_text().strip() == "5"


def test_a_reader_never_sees_a_half_written_file(monkeypatch, tmp_path):
    """The write is a rename, so the file is always a whole timestamp or the old one.

    A reader that caught an empty file would compute a nonsense age and restart a pod
    that was perfectly healthy.
    """
    _configure(monkeypatch, str(tmp_path))
    target = tmp_path / "spans"

    heartbeat.touch(name="spans", now=100)
    for _ in range(25):
        heartbeat.touch(name="spans", now=200)
        assert target.read_text().strip() in {"100", "200"}

    # And nothing is left behind by the rename.
    leftovers = [p.name for p in tmp_path.iterdir() if p.name.startswith(".heartbeat-")]
    assert leftovers == []


def test_a_failed_write_is_reported_not_raised(monkeypatch, tmp_path):
    """A worker loop must survive a filesystem that refuses the write."""
    _configure(monkeypatch, str(tmp_path))

    def refuse(*args, **kwargs):
        raise OSError(30, "Read-only file system")

    monkeypatch.setattr(heartbeat.tempfile, "mkstemp", refuse)

    assert heartbeat.touch(name="spans") is False  # reported, not raised
    assert not (tmp_path / "spans").exists()


def test_a_corrupt_file_reads_as_unknown_rather_than_fresh(monkeypatch, tmp_path):
    """If the file holds something that is not a timestamp, do not claim it is recent."""
    _configure(monkeypatch, str(tmp_path))
    (tmp_path / "spans").write_text("not-a-number\n")

    assert heartbeat.age_seconds(name="spans") is None


@pytest.mark.asyncio
async def test_the_ticker_writes_and_stops_on_cancellation(monkeypatch, tmp_path):
    """The queue worker cancels this task on shutdown; it must exit without raising."""
    import asyncio

    _configure(monkeypatch, str(tmp_path))

    task = asyncio.create_task(
        heartbeat.ticker(name="worker-queues", interval_seconds=0.01)
    )
    await asyncio.sleep(0.05)
    assert (tmp_path / "worker-queues").exists(), (
        "the ticker should have written at least once"
    )

    task.cancel()
    await task  # returns rather than raising CancelledError out of the task body
    assert task.done()


@pytest.mark.asyncio
async def test_the_ticker_returns_at_once_when_unconfigured(monkeypatch):
    """No file configured means no task spinning for the life of the process."""
    _configure(monkeypatch, "")
    await heartbeat.ticker(
        name="worker-queues", interval_seconds=0.01
    )  # returns immediately
