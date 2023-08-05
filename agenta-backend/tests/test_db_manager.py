from random import choice
from string import ascii_letters

import pytest
from agenta_backend.models.api.api_models import App, AppVariant, Image
from agenta_backend.services.db_manager import (
    add_variant_based_on_image,
    engine,
    get_image,
    get_session,
    list_apps,
    list_app_variants,
    remove_app_variant,
    add_variant_based_on_previous,
    print_all,
)
from sqlmodel import Session
from time import sleep


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
    return "".join(choice(ascii_letters) for _ in range(length))


@pytest.fixture
def app_variant():
    return AppVariant(app_name=random_string(), variant_name=random_string())


@pytest.fixture
def app_variant2():
    return AppVariant(app_name=random_string(), variant_name=random_string())


@pytest.fixture
def image() -> Image:
    return Image(docker_id=random_string(), tags=random_string())


def test_add_and_check_exists(app_variant, image):
    add_variant_based_on_image(app_variant, image)
    app_variants = list_app_variants()
    assert len(app_variants) == 1
    assert app_variants[0].app_name == app_variant.app_name
    assert app_variants[0].variant_name == app_variant.variant_name


def test_add_and_remove(app_variant, image):
    add_variant_based_on_image(app_variant, image)
    remove_app_variant(app_variant)
    app_variants = list_app_variants()
    assert len(app_variants) == 0


def test_listing_when_empty():
    app_variants = list_app_variants()
    assert len(app_variants) == 0


def test_add_variant_based_on_image_with_empty_name(image):
    with pytest.raises(ValueError):
        add_variant_based_on_image(
            AppVariant(app_name="", variant_name=random_string()), image
        )


def test_add_same_app_variant_twice(app_variant, image):
    add_variant_based_on_image(app_variant, image)
    # Assumes your function raises ValueError for duplicate adds
    with pytest.raises(ValueError):
        add_variant_based_on_image(app_variant, image)


def test_remove_non_existent_app_variant():
    non_existent_app_variant = AppVariant(
        app_name=random_string(), variant_name=random_string()
    )
    with pytest.raises(ValueError):
        remove_app_variant(non_existent_app_variant)  # Should not raise an error
    assert len(list_app_variants()) == 0


def test_add_multiple_versions_same_app(image):
    app_name = random_string()
    for _ in range(2):  # Add 2 versions of the same app
        app_variant = AppVariant(app_name=app_name, variant_name=random_string())
        add_variant_based_on_image(app_variant, image)
    app_variants = list_app_variants()
    assert len(app_variants) == 2
    for version in app_variants:
        assert version.app_name == app_name


def test_add_remove_different_order(app_variant, app_variant2, image):
    add_variant_based_on_image(app_variant, image)
    add_variant_based_on_image(app_variant2, image)
    remove_app_variant(app_variant)
    app_variants = list_app_variants()
    assert len(app_variants) == 1
    assert app_variants[0].app_name == app_variant2.app_name
    assert app_variants[0].variant_name == app_variant2.variant_name


def test_add_variant_based_on_image_with_image(app_variant, image):
    """Adds variant based on image using an image object

    Arguments:
        app_variant -- _description_
        image -- _description_
    """
    add_variant_based_on_image(app_variant, image)
    app_variants = list_app_variants()
    assert len(app_variants) == 1
    assert app_variants[0].app_name == app_variant.app_name
    assert app_variants[0].variant_name == app_variant.variant_name
    image_ = get_image(
        AppVariant(app_name=app_variant.app_name, variant_name=app_variant.variant_name)
    )
    assert image.docker_id == image_.docker_id
    assert image.tags == image_.tags


def test_filter_by_app_name(image: Image):
    """Adds some app variants with two different apps and checks that list_app_variants
    with the given app_name returns only the app variants with that app_name

    Arguments:
        image -- _description_
    """
    # Assuming you have a setUp function that clears the database before each test
    app_name = "test_app"
    other_app_name = "other_app"

    # Generate some random app variants
    for _ in range(5):
        variant_name = "".join(choice(ascii_letters) for _ in range(10))
        add_variant_based_on_image(
            AppVariant(app_name=app_name, variant_name=variant_name), image
        )

    # Generate some random app variants with a different app name
    for _ in range(3):
        variant_name = "".join(choice(ascii_letters) for _ in range(10))
        add_variant_based_on_image(
            AppVariant(app_name=other_app_name, variant_name=variant_name), image
        )

    # Check that list_app_variants with the given app_name returns only the app variants with that app_name
    app_variants = list_app_variants(app_name)
    assert len(app_variants) == 5
    for app_variant in app_variants:
        assert app_variant.app_name == app_name


def test_list_apps(image):
    # Assuming you have a setUp function that clears the database before each test
    app_name1 = "test_app"
    app_name2 = "other_app"

    # Generate some random app variants
    for _ in range(5):
        variant_name = "".join(choice(ascii_letters) for _ in range(10))
        add_variant_based_on_image(
            AppVariant(app_name=app_name1, variant_name=variant_name), image
        )

    # Generate some random app variants with a different app name
    for _ in range(3):
        variant_name = "".join(choice(ascii_letters) for _ in range(10))
        add_variant_based_on_image(
            AppVariant(app_name=app_name2, variant_name=variant_name), image
        )

    # Check that list_apps returns all unique app names
    app_names = list_apps()
    assert len(app_names) == 2
    assert App(app_name=app_name1) in app_names
    assert App(app_name=app_name2) in app_names


# Tests for variants with parameters


def test_add_and_check_exists_based_on_previous(app_variant, image):
    add_variant_based_on_image(app_variant, image)

    app_variants = list_app_variants()
    new_variant = AppVariant(
        app_name=app_variant.app_name,
        variant_name=random_string(),
        parameters={"param1": "value1", "param2": 10},
    )
    add_variant_based_on_previous(
        previous_app_variant=app_variant,
        new_variant_name=new_variant.variant_name,
        parameters=new_variant.parameters,
    )
    app_variants = list_app_variants()
    assert len(app_variants) == 2
    assert app_variants[1].app_name == new_variant.app_name
    assert app_variants[1].variant_name == new_variant.variant_name
    assert app_variants[1].parameters == new_variant.parameters


def test_add_two_variants_based_on_previous(app_variant, image):
    add_variant_based_on_image(app_variant, image)
    new_variant1 = AppVariant(
        app_name=app_variant.app_name,
        variant_name=random_string(),
        parameters={"param1": "value1", "param2": 10},
    )
    new_variant2 = AppVariant(
        app_name=app_variant.app_name,
        variant_name=random_string(),
        parameters={"param1": "value3", "param2": 20},
    )
    add_variant_based_on_previous(
        previous_app_variant=app_variant,
        new_variant_name=new_variant1.variant_name,
        parameters=new_variant1.parameters,
    )
    add_variant_based_on_previous(
        previous_app_variant=app_variant,
        new_variant_name=new_variant2.variant_name,
        parameters=new_variant2.parameters,
    )
    app_variants = list_app_variants()
    assert len(app_variants) == 3
    for av in app_variants:
        if av.variant_name == new_variant1.variant_name:
            assert av.parameters == new_variant1.parameters
        elif av.variant_name == new_variant2.variant_name:
            assert av.parameters == new_variant2.parameters


def test_add_and_remove_based_on_previous(app_variant, image):
    add_variant_based_on_image(app_variant, image)
    new_variant = AppVariant(
        app_name=app_variant.app_name,
        variant_name=random_string(),
        parameters={"param1": "value1", "param2": 10},
    )
    add_variant_based_on_previous(
        previous_app_variant=app_variant,
        new_variant_name=new_variant.variant_name,
        parameters=new_variant.parameters,
    )
    remove_app_variant(new_variant)
    app_variants = list_app_variants()
    assert len(app_variants) == 1
    assert app_variants[0].app_name == app_variant.app_name
    assert app_variants[0].variant_name == app_variant.variant_name


def test_add_based_on_previous_without_parameters(app_variant, image):
    with pytest.raises(ValueError):
        add_variant_based_on_image(app_variant, image)
        new_variant = AppVariant(
            app_name=app_variant.app_name, variant_name=random_string()
        )
        add_variant_based_on_previous(
            previous_app_variant=app_variant,
            new_variant_name=new_variant.variant_name,
            parameters=None,
        )


def test_add_based_on_previous_invalid_previous(app_variant, image):
    add_variant_based_on_image(app_variant, image)
    new_variant = AppVariant(
        app_name=random_string(),
        variant_name=random_string(),
        parameters={"param1": "value1", "param2": 10},
    )
    with pytest.raises(ValueError):
        add_variant_based_on_previous(
            previous_app_variant=new_variant,
            new_variant_name=new_variant.variant_name,
            parameters=new_variant.parameters,
        )


def test_add_remove_chain_of_variants(app_variant, image):
    # Add original app variant
    add_variant_based_on_image(app_variant, image)

    # Add new variant based on original one
    new_variant1 = AppVariant(
        app_name=app_variant.app_name,
        variant_name=random_string(),
        parameters={"param1": "value1", "param2": 10},
    )
    add_variant_based_on_previous(
        previous_app_variant=app_variant,
        new_variant_name=new_variant1.variant_name,
        parameters=new_variant1.parameters,
    )

    # Add another variant based on the previous one
    new_variant2 = AppVariant(
        app_name=app_variant.app_name,
        variant_name=random_string(),
        parameters={"param1": "value2", "param2": 20},
    )
    with pytest.raises(ValueError):
        add_variant_based_on_previous(
            previous_app_variant=new_variant1,
            new_variant_name=new_variant2.variant_name,
            parameters=new_variant2.parameters,
        )
    add_variant_based_on_previous(
        previous_app_variant=app_variant,
        new_variant_name=new_variant2.variant_name,
        parameters=new_variant2.parameters,
    )

    assert get_image(new_variant1) is not None
    # Remove original variant
    remove_app_variant(app_variant)

    # Image should still exist as other variants are using it
    get_image(app_variant)

    assert get_image(new_variant1) is not None

    # Remove the new variant1
    remove_app_variant(new_variant1)

    # Image should still exist as new_variant2 is using it
    with pytest.raises(Exception):
        get_image(new_variant1)
    assert get_image(new_variant2) is not None

    # Remove the new variant2
    remove_app_variant(new_variant2)

    # Now the image should not exist as all variants using it have been removed
    with pytest.raises(Exception):
        get_image(new_variant2)


def test_add_variant_based_on_previous(app_variant, app_variant2, image):
    add_variant_based_on_image(app_variant, image)
    parameters = {"key": "value"}
    add_variant_based_on_previous(
        previous_app_variant=app_variant,
        new_variant_name=app_variant2.variant_name,
        parameters=parameters,
    )
    app_variants = list_app_variants()
    assert len(app_variants) == 2
    assert app_variants[1].app_name == app_variant.app_name
    assert app_variants[1].variant_name == app_variant2.variant_name


def test_remove_app_variant_and_check_soft_deletion(app_variant, app_variant2, image):
    add_variant_based_on_image(app_variant, image)
    parameters = {"key": "value"}
    add_variant_based_on_previous(app_variant, app_variant2.variant_name, parameters)
    remove_app_variant(app_variant)
    app_variants = list_app_variants(show_soft_deleted=True)
    assert len(app_variants) == 2
    app_variants = list_app_variants()
    assert len(app_variants) == 1


def test_add_variant_after_remove(app_variant, app_variant2, image):
    add_variant_based_on_image(app_variant, image)
    remove_app_variant(app_variant)
    parameters = {"key": "value"}
    with pytest.raises(ValueError):
        add_variant_based_on_previous(
            previous_app_variant=app_variant,
            new_variant_name=app_variant2.variant_name,
            parameters=parameters,
        )


def test_add_variant_based_on_previous_with_soft_deleted_variant(
    app_variant, app_variant2, image
):
    add_variant_based_on_image(app_variant, image)
    parameters = {"key": "value"}
    add_variant_based_on_previous(
        app_variant, app_variant2.variant_name + "2", parameters
    )
    remove_app_variant(app_variant)

    add_variant_based_on_previous(app_variant, app_variant2.variant_name, parameters)
    app_variants = list_app_variants()
    print_all()
    assert len(app_variants) == 2
    assert app_variants[1].app_name == app_variant.app_name
    assert app_variants[1].variant_name == app_variant2.variant_name
