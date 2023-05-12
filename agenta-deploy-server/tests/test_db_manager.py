import pytest
from deploy_server.models.api_models import AppVersion, Image
from random import choice
from string import ascii_letters
from deploy_server.services.db_manager import get_session, list_app_versions, add_app_version, remove_app_version, engine, get_image
from sqlmodel import Session


@pytest.fixture(autouse=True)
def cleanup():
    """Fixture that is automatically used before each test."""
    # Setup: clean up the database

    with Session(engine) as session:
        # adjust with your table name
        session.execute("DELETE FROM appversiondb")
        session.execute("DELETE FROM imagedb")  # adjust with your table name
        session.commit()
    yield


def test_get_session():
    assert get_session() is not None


def test_list():
    print(list_app_versions())
    assert list_app_versions() == []


def random_string(length=10):
    return ''.join(choice(ascii_letters) for _ in range(length))


@pytest.fixture
def app_version():
    return AppVersion(app_name=random_string(), version_name=random_string())


@pytest.fixture
def app_version2():
    return AppVersion(app_name=random_string(), version_name=random_string())


@pytest.fixture
def image():
    return Image(docker_id=random_string(), tags=random_string())


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


def test_add_app_version_with_empty_name(image):
    with pytest.raises(ValueError):
        add_app_version(AppVersion(
            app_name='', version_name=random_string()), image)


def test_add_same_app_version_twice(app_version, image):
    add_app_version(app_version, image)
    # Assumes your function raises ValueError for duplicate adds
    with pytest.raises(ValueError):
        add_app_version(app_version, image)


def test_remove_non_existent_app_version():
    non_existent_app_version = AppVersion(
        app_name=random_string(), version_name=random_string())
    remove_app_version(non_existent_app_version)  # Should not raise an error
    assert len(list_app_versions()) == 0


def test_add_multiple_versions_same_app(image):
    app_name = random_string()
    for _ in range(2):  # Add 2 versions of the same app
        app_version = AppVersion(
            app_name=app_name, version_name=random_string())
        add_app_version(app_version, image)
    app_versions = list_app_versions()
    assert len(app_versions) == 2
    for version in app_versions:
        assert version.app_name == app_name


def test_add_remove_different_order(app_version, app_version2, image):
    add_app_version(app_version, image)
    add_app_version(app_version2, image)
    remove_app_version(app_version)
    app_versions = list_app_versions()
    assert len(app_versions) == 1
    assert app_versions[0].app_name == app_version2.app_name
    assert app_versions[0].version_name == app_version2.version_name


def test_add_app_version_with_image(app_version, image):
    add_app_version(app_version, image)
    app_versions = list_app_versions()
    assert len(app_versions) == 1
    assert app_versions[0].app_name == app_version.app_name
    assert app_versions[0].version_name == app_version.version_name
    image_ = get_image(AppVersion(app_name=app_version.app_name,
                       version_name=app_version.version_name))
    assert image.docker_id == image_.docker_id
    assert image.tags == image_.tags
