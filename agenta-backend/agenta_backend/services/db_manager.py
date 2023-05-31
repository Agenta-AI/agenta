import os
from typing import Dict, List, Optional, Any

from agenta_backend.models.api.api_models import App, AppVariant, Image
from agenta_backend.models.converters import (app_variant_db_to_pydantic,
                                              image_db_to_pydantic)
from agenta_backend.models.db_models import AppVariantDB, ImageDB
from agenta_backend.services import helpers
from sqlmodel import Session, SQLModel, create_engine, func, and_
import logging
# SQLite database connection
DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(DATABASE_URL)
# Create tables if they don't exist
SQLModel.metadata.create_all(engine)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def get_session():
    """Returns a session to the database

    Yields:
        SQLModel.Session: A session to the database
    """
    with Session(engine) as session:
        yield session


def add_variant_based_on_image(app_variant: AppVariant, image: Image):
    """Adds an app variant based on an image. This the functionality called by the cli.
    Currently we are not using the parameters field, but it is there for future use.

    Arguments:
        app_variant -- contains the app name and variant name and optionally the parameters
        image -- contains the docker id and the tags

    Raises:
        ValueError: if variant exists or missing inputs
    """
    clean_soft_deleted_variants()
    if app_variant is None or image is None or app_variant.app_name in [None, ""] or app_variant.variant_name in [None, ""] or image.docker_id in [None, ""] or image.tags in [None, ""]:
        raise ValueError("App variant or image is None")
    if app_variant.parameters is not None:
        raise ValueError("Parameters are not supported when adding based on image")
    already_exists = any([av for av in list_app_variants(show_soft_deleted=True) if av.app_name ==
                          app_variant.app_name and av.variant_name == app_variant.variant_name])
    if already_exists:
        raise ValueError("App variant with the same name already exists")
    with Session(engine) as session:
        # Add image
        db_image = ImageDB(**image.dict())
        session.add(db_image)
        session.commit()
        session.refresh(db_image)
        # Add app variant and link it to the app variant
        db_app_variant = AppVariantDB(
            image_id=db_image.id,  **app_variant.dict())
        session.add(db_app_variant)
        session.commit()
        session.refresh(db_app_variant)


def add_variant_based_on_previous(previous_app_variant: AppVariant, new_variant_name: str, parameters: Dict[str, Any]):
    """Adds a new variant from a previous/template one by changing the parameters.

    Arguments:
        app_variant -- contains the name of the app and variant

    Keyword Arguments:
        parameters -- the new parameters. 

    Raises:
        ValueError: _description_
    """
    clean_soft_deleted_variants()
    if previous_app_variant is None or previous_app_variant.app_name in [None, ""] or previous_app_variant.variant_name in [None, ""]:
        raise ValueError("App variant is None")
    if parameters is None:
        raise ValueError("Parameters is None")

    # get the template variant to base the new one on
    with Session(engine) as session:
        template_variant: AppVariantDB = session.query(AppVariantDB).filter(
            (AppVariantDB.app_name == previous_app_variant.app_name) & (AppVariantDB.variant_name == previous_app_variant.variant_name)).first()

    if template_variant is None:
        print_all()
        raise ValueError("Template app variant not found")
    elif template_variant.previous_variant_name is not None:
        raise ValueError(
            "Template app variant is not a template, it is a forked variant itself")

    already_exists = any([av for av in list_app_variants(show_soft_deleted=True) if av.app_name ==
                          previous_app_variant.app_name and av.variant_name == new_variant_name])
    if already_exists:
        raise ValueError("App variant with the same name already exists")

    with Session(engine) as session:
        db_app_variant = AppVariantDB(
            app_name=template_variant.app_name,
            variant_name=new_variant_name,
            image_id=template_variant.image_id,
            parameters=parameters,
            previous_variant_name=template_variant.variant_name)
        session.add(db_app_variant)
        session.commit()
        session.refresh(db_app_variant)


def list_app_variants(app_name: str = None, show_soft_deleted=False) -> List[AppVariant]:
    """
    Lists all the app variants from the db
    Args:
        app_name: if specified, only returns the variants for the app name
        show_soft_deleted: if true, returns soft deleted variants as well
    Returns:
        List[AppVariant]: List of AppVariant objects
    """
    clean_soft_deleted_variants()
    with Session(engine) as session:
        query = session.query(AppVariantDB)
        if not show_soft_deleted:
            query = query.filter(AppVariantDB.is_deleted == False)
        if app_name is not None:
            query = query.filter(AppVariantDB.app_name == app_name)

        subquery = session.query(AppVariantDB.app_name, AppVariantDB.variant_name).group_by(
            AppVariantDB.app_name, AppVariantDB.variant_name).subquery()

        query = query.join(subquery, and_(AppVariantDB.app_name == subquery.c.app_name,
                                          AppVariantDB.variant_name == subquery.c.variant_name))
        app_variants_db: List[AppVariantDB] = query.all()

        # Include previous variant name
        app_variants: List[AppVariant] = []
        for av in app_variants_db:
            app_variant = app_variant_db_to_pydantic(av)
            app_variants.append(app_variant)
        return app_variants


def list_apps() -> List[App]:
    """
    Lists all the unique app names from the database
    """
    clean_soft_deleted_variants()
    with Session(engine) as session:
        app_names = session.query(AppVariantDB.app_name).distinct().all()
        # Unpack tuples to create a list of strings instead of a list of tuples
        return [App(app_name=name) for (name,) in app_names]


def get_image(app_variant: AppVariant) -> Image:
    """Returns the image associated with the app variant

    Arguments:
        app_variant -- AppVariant to fetch the image for

    Returns:
        Image -- The Image associated with the app variant
    """

    with Session(engine) as session:
        db_app_variant: AppVariantDB = session.query(AppVariantDB).filter(
            (AppVariantDB.app_name == app_variant.app_name) & (AppVariantDB.variant_name == app_variant.variant_name)).first()
        if db_app_variant:
            image_db: ImageDB = session.query(ImageDB).filter(
                ImageDB.id == db_app_variant.image_id).first()
            return image_db_to_pydantic(image_db)
        else:
            raise Exception("App variant not found")


def remove_app_variant(app_variant: AppVariant):
    """Remove an app variant from the db 
    the logic for removing the image is in app_manager.py

    Arguments:
        app_variant -- AppVariant to remove
    """
    if app_variant is None or app_variant.app_name in [None, ""] or app_variant.variant_name in [None, ""]:
        raise ValueError("App variant is None")
    with Session(engine) as session:
        app_variant_db = session.query(AppVariantDB).filter(
            (AppVariantDB.app_name == app_variant.app_name) & (AppVariantDB.variant_name == app_variant.variant_name)).first()
        if app_variant_db is None:
            raise ValueError("App variant not found")

        if app_variant_db.previous_variant_name is not None:  # forked variant
            session.delete(app_variant_db)
        elif check_is_last_variant(app_variant_db):  # last variant using the image, okay to delete
            session.delete(app_variant_db)
        else:
            app_variant_db.is_deleted = True  # soft deletion
        session.commit()


def remove_image(image: Image):
    """Remove image from db based on pydantic class

    Arguments:
        image -- Image to remove
    """
    if image is None or image.docker_id in [None, ""] or image.tags in [None, ""]:
        raise ValueError("Image is None")
    with Session(engine) as session:
        image_db = session.query(ImageDB).filter(
            (ImageDB.docker_id == image.docker_id) & (ImageDB.tags == image.tags)).first()
        if image_db is None:
            raise ValueError("Image not found")
        session.delete(image_db)
        session.commit()


def check_is_last_variant(db_app_variant: AppVariantDB) -> bool:
    """Checks whether the input variant is the sole variant that uses its linked image
    This is a helpful function to determine whether to delete the image when removing a variant
    Usually many variants will use the same image (these variants would have been created using the UI)
    We only delete the image and shutdown the container if the variant is the last one using the image

    Arguments:
        app_variant -- AppVariant to check
    Returns:
        true if it's the last variant, false otherwise
    """
    with Session(engine) as session:
        # If it's the only variant left that uses the image, delete the image
        if session.query(AppVariantDB).filter(AppVariantDB.image_id == db_app_variant.image_id).count() == 1:
            return True
        else:
            return False


def get_variant_from_db(app_variant: AppVariant) -> AppVariantDB:
    """Checks whether the app variant exists in our db
    and returns the AppVariantDB object if it does

    Arguments:
        app_variant -- AppVariant to check

    Returns:
        AppVariantDB -- The AppVariantDB object if it exists, None otherwise
    """
    with Session(engine) as session:
        # Find app_variant in the database
        db_app_variant: AppVariantDB = session.query(AppVariantDB).filter(
            (AppVariantDB.app_name == app_variant.app_name) & (AppVariantDB.variant_name == app_variant.variant_name)).first()
        logger.info(f"Found app variant: {db_app_variant}")
        if db_app_variant:
            return db_app_variant
        else:
            return None


def print_all():
    """Prints all the tables in the database
    """
    with Session(engine) as session:
        for app_variant in session.query(AppVariantDB).all():
            helpers.print_app_variant(app_variant)
        for image in session.query(ImageDB).all():
            helpers.print_image(image)


def clean_soft_deleted_variants():
    """Remove soft-deleted app variants if their image is not used by any existing variant.
    """
    with Session(engine) as session:
        # Get all soft-deleted app variants
        soft_deleted_variants: List[AppVariantDB] = session.query(
            AppVariantDB).filter(AppVariantDB.is_deleted == True).all()

        for variant in soft_deleted_variants:
            # Get non-deleted variants that use the same image
            image_used = session.query(AppVariantDB).filter(
                (AppVariantDB.image_id == variant.image_id) & (AppVariantDB.is_deleted == False)).first()

            # If the image is not used by any non-deleted variant, delete the variant
            if image_used is None:
                session.delete(variant)

        session.commit()


def update_variant_parameters(app_variant: AppVariant, parameters: Dict[str, Any]):
    """Updates the parameters of a specific variant

    Arguments:
        app_variant -- contains the name of the app and variant
        parameters -- the new parameters. 

    Raises:
        ValueError: If the variant doesn't exist or parameters is None.
    """
    if app_variant is None or app_variant.app_name in [None, ""] or app_variant.variant_name in [None, ""]:
        raise ValueError("App variant is None")
    if parameters is None:
        raise ValueError("Parameters is None")

    with Session(engine) as session:
        db_app_variant: AppVariantDB = session.query(AppVariantDB).filter(
            (AppVariantDB.app_name == app_variant.app_name) & (AppVariantDB.variant_name == app_variant.variant_name)).first()

        if db_app_variant is None:
            raise ValueError("App variant not found")

        # Update parameters
        if set(db_app_variant.parameters.keys()) != set(parameters.keys()):
            logger.error(f"Parameters keys don't match: {db_app_variant.parameters.keys()} vs {parameters.keys()}")
            raise ValueError("Parameters keys don't match")
        db_app_variant.parameters = parameters
        session.commit()
