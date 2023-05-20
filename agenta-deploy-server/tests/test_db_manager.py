import pytest
from deploy_server.models.api.api_models import AppVariant, Image
from random import choice
from string import ascii_letters
from deploy_server.services.db_manager import get_session, list_app_variants, add_app_variant, remove_app_variant, engine, get_image
from sqlmodel import Session


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


def test_get_session():
    assert get_session() is not None


def test_list():
    print(list_app_variants())
    assert list_app_variants() == []


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


def test_add_and_check_exists(app_variant, image):
    add_app_variant(app_variant, image)
    app_variants = list_app_variants()
    assert len(app_variants) == 1
    assert app_variants[0].app_name == app_variant.app_name
    assert app_variants[0].variant_name == app_variant.variant_name


def test_add_and_remove(app_variant, image):
    add_app_variant(app_variant, image)
    remove_app_variant(app_variant)
    app_variants = list_app_variants()
    assert len(app_variants) == 0


def test_listing_when_empty():
    app_variants = list_app_variants()
    assert len(app_variants) == 0


def test_add_app_variant_with_empty_name(image):
    with pytest.raises(ValueError):
        add_app_variant(AppVariant(
            app_name='', variant_name=random_string()), image)


def test_add_same_app_variant_twice(app_variant, image):
    add_app_variant(app_variant, image)
    # Assumes your function raises ValueError for duplicate adds
    with pytest.raises(ValueError):
        add_app_variant(app_variant, image)


def test_remove_non_existent_app_variant():
    non_existent_app_variant = AppVariant(
        app_name=random_string(), variant_name=random_string())
    remove_app_variant(non_existent_app_variant)  # Should not raise an error
    assert len(list_app_variants()) == 0


def test_add_multiple_versions_same_app(image):
    app_name = random_string()
    for _ in range(2):  # Add 2 versions of the same app
        app_variant = AppVariant(
            app_name=app_name, variant_name=random_string())
        add_app_variant(app_variant, image)
    app_variants = list_app_variants()
    assert len(app_variants) == 2
    for version in app_variants:
        assert version.app_name == app_name


def test_add_remove_different_order(app_variant, app_variant2, image):
    add_app_variant(app_variant, image)
    add_app_variant(app_variant2, image)
    remove_app_variant(app_variant)
    app_variants = list_app_variants()
    assert len(app_variants) == 1
    assert app_variants[0].app_name == app_variant2.app_name
    assert app_variants[0].variant_name == app_variant2.variant_name


def test_add_app_variant_with_image(app_variant, image):
    add_app_variant(app_variant, image)
    app_variants = list_app_variants()
    assert len(app_variants) == 1
    assert app_variants[0].app_name == app_variant.app_name
    assert app_variants[0].variant_name == app_variant.variant_name
    image_ = get_image(AppVariant(app_name=app_variant.app_name,
                       variant_name=app_variant.variant_name))
    assert image.docker_id == image_.docker_id
    assert image.tags == image_.tags
