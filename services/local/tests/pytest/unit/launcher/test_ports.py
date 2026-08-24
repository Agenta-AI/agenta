from agenta_local.launcher.ports import retry_eaddrinuse


def test_port_collision_retries_with_new_loopback_port(tmp_path):
    log = tmp_path / "runner.log"
    ports = iter((41001, 41002))
    attempted = []

    def attempt(port):
        attempted.append(port)
        if len(attempted) == 1:
            log.write_bytes(b"listen EADDRINUSE 127.0.0.1\n")
            return "first", False
        with log.open("ab") as stream:
            stream.write(b"ready\n")
        return "second", True

    result, port = retry_eaddrinuse(
        attempt,
        log_path=log,
        choose_port=lambda: next(ports),
    )

    assert (result, port) == ("second", 41002)
    assert attempted == [41001, 41002]


def test_non_collision_failure_does_not_retry(tmp_path):
    log = tmp_path / "service.log"
    calls = []

    def attempt(port):
        calls.append(port)
        log.write_bytes(b"migration failed\n")
        return object(), False

    try:
        retry_eaddrinuse(attempt, log_path=log, choose_port=lambda: 42000)
    except RuntimeError as exc:
        assert str(log) in str(exc)
    else:
        raise AssertionError("failure should be reported")
    assert calls == [42000]


def test_python_eaddrinuse_wording_also_retries(tmp_path):
    log = tmp_path / "service.log"
    ports = iter((43001, 43002))
    calls = []

    def attempt(port):
        calls.append(port)
        if len(calls) == 1:
            log.write_bytes(b"[Errno 98] address already in use\n")
            return object(), False
        return object(), True

    _, port = retry_eaddrinuse(
        attempt,
        log_path=log,
        choose_port=lambda: next(ports),
    )

    assert port == 43002
