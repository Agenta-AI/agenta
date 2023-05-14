import docker
import pytest
from fastapi.testclient import TestClient
from deploy_server.main import app  # import your FastAPI application
import io
client = TestClient(app)


@pytest.fixture(scope="session")
def docker_client():
    return docker.from_env()


@pytest.fixture(scope="session")
def test_image(docker_client):
    # Create a simple Docker image using Python's official image
    # This Dockerfile will just create a new image based on python:3.9-slim
    dockerfile = """
    FROM python:3.9-slim
    """

    image, _ = docker_client.images.build(fileobj=io.BytesIO(
        dockerfile.encode('utf-8')), tag="test:latest")
    return image


@pytest.fixture(scope="session", autouse=True)
def cleanup(docker_client, test_image):
    """Fixture that is automatically used before each test."""
    yield
    # Cleanup: remove the test image after all tests have run
    docker_client.images.remove(test_image.id)


def test_list_app_versions():
    response = client.get("/list/")
    assert response.status_code == 200
    assert response.json() == []  # Assuming the db is empty


# def test_add_model(app_version, image):
#     response = client.post(
#         "/add/", json={"app_version": app_version.dict(), "image": image.dict()})
#     if image in docker_utils.list_images():
#         assert response.status_code == 200
#     else:
#         assert response.status_code == 500


# def test_start_model(app_version, image):
#     db_manager.add_app_version(app_version, image)
#     response = client.post("/start/", json={"app_version": app_version.dict()})
#     assert response.status_code == 200
#     # Assuming URI will be a dict with {"uri": "some_uri"}
#     assert "uri" in response.json()


# def test_stop_model(app_version, image):
#     db_manager.add_app_version(app_version, image)
#     docker_utils.start_container(image)
#     response = client.post("/stop/", json={"app_version": app_version.dict()})
#     assert response.status_code == 200
#     assert response.json() == {
#         "detail": "Container stopped and deleted successfully"}
