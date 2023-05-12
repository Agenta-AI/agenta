import pytest
from deploy_server.models.api_models import AppVersion, Image
from deploy_server import add_app_version, list_app_versions, get_image, remove_app_version
from random import choice
from string import ascii_letters

# Helper function to generate random app_name and version_name


def random_string(length=10):
    return ''.join(choice(ascii_letters) for _ in range(length))


@pytest.fixture
def app_version():
    return AppVersion(app_name=random_string(), version_name=random_string())


@pytest.fixture
def image():
    return Image(id=random_string(), tags=random_string())


def test_add_and_check_exists(app_version, image):
    add_app_version(app_version, image)
    app_versions = list_app_versions()
    assert len(app_versions) == 1
    assert app_versions[0].app_name == app_version.app_name
    assert app_versions[0].version_name == app_version.version_name


def test_add_and_remove(app_version, image):
    add_app_version(app_version, image)
    remove_app_version(app_version)
    app_versions = list_app_versions()
    assert len(app_versions) == 0


def test_listing_when_empty():
    app_versions = list_app_versions()
    assert len(app_versions) == 0


def test_adding_10_randoms_then_listing():
    for _ in range(10):
        app_version = AppVersion(
            app_name=random_string(), version_name=random_string())
        image = Image(id=random_string(), tags=random_string())
        add_app_version(app_version, image)

    app_versions = list_app_versions()
    pass
