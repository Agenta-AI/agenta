from sqlmodel import Session, SQLModel, create_engine
from deploy_server.models.api.api_models import AppVariant, Image, App
from deploy_server.models.db_models import AppVariantDB, ImageDB
from deploy_server.models.converters import app_variant_db_to_pydantic, image_db_to_pydantic
from typing import List
import os

# SQLite database connection
DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(DATABASE_URL)

# Create tables if they don't exist
SQLModel.metadata.create_all(engine)


def get_session():
    """Returns a session to the database

    Yields:
        SQLModel.Session: A session to the database
    """
    with Session(engine) as session:
        yield session


def add_app_variant(app_variant: AppVariant, image: Image):
    """Adds a new app variant to the db. 
    First adds an app variant, then adds the image to the db and links it to the app variant

    Arguments:
        app_variant -- AppVariant to add
        image -- The Image associated with the app variant
    """
    if app_variant is None or image is None or app_variant.app_name in [None, ""] or app_variant.variant_name in [None, ""] or image.docker_id in [None, ""] or image.tags in [None, ""]:
        raise ValueError("App variant or image is None")
    already_exists = any([av for av in list_app_variants() if av.app_name ==
                          app_variant.app_name and av.variant_name == app_variant.variant_name])
    if already_exists:
        raise ValueError("App variant already exists")
    with Session(engine) as session:
        # Add image
        db_image = ImageDB(**image.dict())
        session.add(db_image)
        session.commit()
        session.refresh(db_image)
        # Add app variant and link it to the app variant
        db_app_variant = AppVariantDB(
            image_id=db_image.id, **app_variant.dict())
        session.add(db_app_variant)
        session.commit()
        session.refresh(db_app_variant)


def list_app_variants(app_name: str = None) -> List[AppVariant]:
    """
    Lists all the app variants from the db"""

    with Session(engine) as session:
        query = session.query(AppVariantDB)
        if app_name is not None:
            query = query.filter(AppVariantDB.app_name == app_name)

        app_variants_db: List[AppVariantDB] = query.all()

        # Assuming app_variant_db_to_pydantic() function is defined somewhere else
        return [app_variant_db_to_pydantic(av) for av in app_variants_db]


def list_app_names() -> List[App]:
    """
    Lists all the unique app names from the database
    """

    with Session(engine) as session:
        app_names = session.query(AppVariantDB.app_name).distinct().all()

        # Unpack tuples to create a list of strings instead of a list of tuples
        return [App(app_name=name) for (name,) in app_names]


def get_image(app_variant: AppVariant) -> Image:
    """Returns the image associated with the app variant

    Arguments:
        app_variant -- _description_

    Returns:
        _description_
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


def remove_app_variant(app_variant: AppVariant) -> bool:
    """Remove an app variant and its associated image from the db 

    Arguments:
        app_variant -- _description_
    Returns:
        bool -- True if the app variant was removed, False otherwise
    """

    with Session(engine) as session:
        # Find app_variant in the database
        db_app_variant: AppVariantDB = session.query(AppVariantDB).filter(
            (AppVariantDB.app_name == app_variant.app_name) & (AppVariantDB.variant_name == app_variant.variant_name)).first()
        if db_app_variant:
            # Delete associated image
            db_image: ImageDB = session.query(ImageDB).filter(
                ImageDB.id == db_app_variant.image_id).first()
            if db_image:
                session.delete(db_image)
            else:
                raise Exception("Image for app not found")

            # Delete app_variant
            session.delete(db_app_variant)
            session.commit()
            return True
        else:
            return False
