import io
from random import choice
from string import ascii_letters

import docker
import pytest
from agenta_backend.main import app
from agenta_backend.models.api.api_models import AppVariant, Image
from agenta_backend.services.db_manager import (add_app_variant, engine,
                                                get_image, get_session,
                                                list_app_variants,
                                                remove_app_variant)
from fastapi.testclient import TestClient
from sqlmodel import Session

client = TestClient(app)


@pytest.fixture(autouse=True)
def cleanup():
    """Fixture that is automatically used before each test."""
    # Setup: clean up the database

    with Session(engine) as session:
        # adjust with your table name
        session.execute("DELETE FROM appvariantdb")
        session.execute("DELETE FROM imagedb")  # adjust with your table name
        session.commit()
    yield


@pytest.fixture(scope="session")
def docker_client():
    return docker.from_env()


def random_string(length=10):
    return ''.join(choice(ascii_letters) for _ in range(length))


@pytest.fixture
def app_variant():
    return AppVariant(app_name=random_string(), variant_name=random_string())


@pytest.fixture
def app_variant2():
    return AppVariant(app_name=random_string(), variant_name=random_string())


@pytest.fixture
def image():
    return Image(docker_id=random_string(), tags=random_string())


@pytest.fixture(scope="session")
def docker_test_image(docker_client):
    # Create a simple Docker image using Python's official image
    # This Dockerfile will just create a new image based on python:3.9-slim
    dockerfile = """
    FROM python:3.9-slim
    """

    image, _ = docker_client.images.build(fileobj=io.BytesIO(
        dockerfile.encode('utf-8')), tag="agenta-server/test:latest")
    return image


def test_list_app_variant():
    response = client.get("/app_variant/list_variants/")
    assert response.status_code == 200
    assert response.json() == []


def test_list_app_variant_after_manual_add(app_variant, image):
    # This is the function from db_manager.py
    add_app_variant(app_variant, image)
    response = client.get("/app_variant/list_variants/")
    assert response.status_code == 200
    assert len(response.json()) == 1
    result = AppVariant(**response.json()[0])
    assert result.app_name == app_variant.app_name
    assert result.variant_name == app_variant.variant_name


def test_add_variant(app_variant, docker_test_image):
    image = Image(docker_id=docker_test_image.id,
                  tags=docker_test_image.tags[0])
    response = client.post(
        "app_variant/add/", json={"app_variant": app_variant.dict(), "image": image.dict()})
    assert response.status_code == 200
    response = client.get("/app_variant/list_variants/")
    assert response.status_code == 200
    assert len(response.json()) == 1
    result = AppVariant(**response.json()[0])
    assert result.app_name == app_variant.app_name
    assert result.variant_name == app_variant.variant_name


def test_add_variant_with_wrong_image_tag(app_variant, image):
    response = client.post(
        "app_variant/add/", json={"app_variant": app_variant.dict(), "image": image.dict()})
    assert response.status_code == 500


def test_add_variant_not_in_docker_registry(app_variant, image):
    image.tags = "agenta-server/notexist:latest"
    response = client.post(
        "app_variant/add/", json={"app_variant": app_variant.dict(), "image": image.dict()})
    assert response.status_code == 500

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
