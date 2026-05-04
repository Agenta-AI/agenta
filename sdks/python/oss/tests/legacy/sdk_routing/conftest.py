import os
import sys
import time
import uuid
import socket
import random
import threading
import subprocess
from pathlib import Path
from importlib.metadata import version

import httpx
import pytest

from tests.legacy.conftest import get_admin_user_credentials, API_BASE_URL


BASE_URL = os.getenv("BASE_URL", "http://127.0.0.1")


def get_free_port(start=8001, end=8999, max_attempts=100):
    """
    Find an available port within the specified range with a maximum number of attempts.
    """

    attempts = 0

    while attempts < max_attempts:
        port = random.randint(start, end)

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port

            except OSError:
                attempts += 1

    raise RuntimeError("Could not find a free port within the range")


@pytest.fixture(scope="class")
def get_agenta_version():
    return version("agenta")


@pytest.fixture(scope="class")
def executable_python():
    """
    Fixture to provide the current Python executable.
    """

    python_executable = sys.executable
    return python_executable


@pytest.fixture(scope="class")
def get_port_number():
    port = get_free_port()
    return port


@pytest.fixture(scope="class")
def http_client(get_port_number):
    """
    Create an HTTP client for API testing.
    """

    programmatic_access = get_admin_user_credentials()
    with httpx.Client(
        base_url=f"{BASE_URL}:{get_port_number}",
        timeout=httpx.Timeout(timeout=6, read=None, write=5),
        headers={
            "Authorization": f"{programmatic_access}",
            "Content-Type": "application/json",
        },
    ) as client:
        yield client


@pytest.fixture(scope="class")
def create_application(http_client):
    """
    Create an application and set the APP_ID in the environment
    """

    response = http_client.post(
        f"{API_BASE_URL}apps/", json={"app_name": f"app_{uuid.uuid4().hex[:8]}"}
    )
    response.raise_for_status()
    response_data = response.json()
    return response_data


@pytest.fixture(scope="class")
def fastapi_server(
    request, get_port_number, create_application, http_client, executable_python
):
    """
    Run the FastAPI server as a subprocess on a random port and return its base URL.
    """

    app_id = create_application.get("app_id", None)
    app_file = request.param.get("app_file", "main.py")
    env_vars = request.param.get("env_vars", {})

    app_folder = Path(__file__).parent

    if not (app_folder / app_file).exists():
        raise FileNotFoundError(f"FastAPI app not found at: {app_folder / app_file}")

    env_vars.update(
        {
            "AGENTA_APP_ID": app_id,
            "AGENTA_HOST": BASE_URL,
            "HOST": "0.0.0.0",
            "PORT": str(get_port_number),
        }
    )

    command = [
        executable_python,
        app_file,
    ]

    process = subprocess.Popen(
        command,
        cwd=app_folder,
        env=env_vars,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    def print_logs(pipe, prefix):
        for line in iter(pipe.readline, ""):
            print(f"{prefix}: {line.strip()}")
        pipe.close()

    threading.Thread(
        target=print_logs,
        args=(process.stdout, "STDOUT"),
        daemon=True,
    ).start()
    threading.Thread(
        target=print_logs,
        args=(process.stderr, "STDERR"),
        daemon=True,
    ).start()

    # Wait a bit for the server to start
    time.sleep(2)

    yield BASE_URL, process

    process.terminate()
    process.wait()

    # Remove application after server teardown
    response = http_client.delete(f"{API_BASE_URL}apps/{app_id}")
    response.raise_for_status()


@pytest.fixture(scope="class")
def ensure_server(fastapi_server, http_client):
    """
    Ensure the server is running by checking the health endpoint.
    """

    _, process = fastapi_server

    for i in range(10):
        try:
            response = http_client.get("/")
            if response.status_code == 200:
                return

            print(
                f"Health check attempt {i + 1}/10 failed with status {response.status_code}"
            )
        except (ConnectionError, TimeoutError) as e:
            print(f"Health check attempt {i + 1}/10 failed: {e}")
            time.sleep(2)

    stdout, stderr = process.communicate(timeout=1)
    raise RuntimeError(
        f"Server failed to respond to health checks\nStdout: {stdout}\nStderr: {stderr}"
    )
