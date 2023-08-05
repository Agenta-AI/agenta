import pytest
from unittest.mock import MagicMock, patch
from agenta_backend.services.docker_utils import (
    start_container,
    stop_container,
    delete_container,
    list_images,
)
from agenta_backend.models.api.api_models import Image


@pytest.fixture
def mock_client():
    with patch("docker.from_env") as mock:
        yield mock()


def test_start_container(mock_client):
    mock_image = MagicMock()
    mock_container = MagicMock()
    mock_client.images.get.return_value = mock_image
    mock_client.containers.run.return_value = mock_container

    container = start_container("test_image", "test_tag")

    mock_client.images.get.assert_called_once_with(
        "test_registry_url/test_image:test_tag"
    )  # replace with your actual registry url
    assert isinstance(container, Container)


def test_stop_container(mock_client):
    mock_container = MagicMock()
    mock_client.containers.get.return_value = mock_container

    stop_container("test_id")

    mock_client.containers.get.assert_called_once_with("test_id")
    mock_container.stop.assert_called_once()


def test_delete_container(mock_client):
    mock_container = MagicMock()
    mock_client.containers.get.return_value = mock_container

    delete_container("test_id")

    mock_client.containers.get.assert_called_once_with("test_id")
    mock_container.remove.assert_called_once()


def test_list_images(mock_client):
    mock_image = MagicMock()
    mock_image.id = "test_id"
    # replace with your actual registry
    mock_image.tags = ["test_registry/test_tag"]
    mock_client.images.list.return_value = [mock_image]

    images = list_images()

    assert len(images) == 1
    assert isinstance(images[0], Image)
    assert images[0].docker_id == "test_id"
    # replace with your actual registry
    assert images[0].tags == "test_registry/test_tag"
