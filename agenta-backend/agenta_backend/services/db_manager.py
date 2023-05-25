import os
from typing import Dict, List, Optional, Any

from agenta_backend.models.api.api_models import App, AppVariant, Image
from agenta_backend.models.converters import (app_variant_db_to_pydantic,
                                              image_db_to_pydantic)
from agenta_backend.models.db_models import AppVariantDB, ImageDB
from sqlmodel import Session, SQLModel, create_engine, func, and_

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


def add_variant_based_on_image(app_variant: AppVariant, image: Image):
    """Adds an app variant based on an image. This the functionality called by the cli.
    Currently we are not using the parameters field, but it is there for future use.

    Arguments:
        app_variant -- contains the app name and variant name and optionally the parameters
        image -- contains the docker id and the tags

    Raises:
        ValueError: if variant exists or missing inputs
    """
    if app_variant is None or image is None or app_variant.app_name in [None, ""] or app_variant.variant_name in [None, ""] or image.docker_id in [None, ""] or image.tags in [None, ""]:
        raise ValueError("App variant or image is None")
    if app_variant.parameters is not None:
        raise ValueError("Parameters are not supported when adding based on image")
    if app_variant.previous_variant_id is not None:
        raise ValueError(
            "Previous variant name is not supported when adding based on image")
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
    if previous_app_variant is None or previous_app_variant.app_name in [None, ""] or previous_app_variant.variant_name in [None, ""]:
        raise ValueError("App variant is None")
    if parameters is None:
        raise ValueError("Parameters is None")

    # get the template variant to base the new one on
    with Session(engine) as session:
        template_variant: AppVariantDB = session.query(AppVariantDB).filter(
            (AppVariantDB.app_name == previous_app_variant.app_name) & (AppVariantDB.variant_name == previous_app_variant.variant_name)).first()

    if template_variant is None:
        raise ValueError("Template app variant not found")
    elif template_variant.previous_variant_id is not None:
        raise ValueError(
            "Template app variant is not a template, it is a variant itself")

    with Session(engine) as session:
        db_app_variant = AppVariantDB(
            app_name=template_variant.app_name,
            variant_name=new_variant_name,
            image_id=template_variant.image_id,
            parameters=parameters,
            previous_variant_id=template_variant.id,
            version=template_variant.version + 1)
        session.add(db_app_variant)
        session.commit()
        session.refresh(db_app_variant)


def list_app_variants(app_name: str = None) -> List[AppVariant]:
    """
    Lists all the app variants from the db, only latest versions
    TODO: TEST THIS

    """

    with Session(engine) as session:
        query = session.query(AppVariantDB)
        if app_name is not None:
            query = query.filter(AppVariantDB.app_name == app_name)

        # Get latest versions only
        subquery = session.query(AppVariantDB.app_name, AppVariantDB.variant_name, func.max(AppVariantDB.version).label("max_version"))\
            .group_by(AppVariantDB.app_name, AppVariantDB.variant_name).subquery()

        query = query.join(subquery, and_(AppVariantDB.app_name == subquery.c.app_name,
                                          AppVariantDB.variant_name == subquery.c.variant_name,
                                          AppVariantDB.version == subquery.c.max_version))
        app_variants_db: List[AppVariantDB] = query.all()

        # Include previous variant name
        app_variants: List[AppVariant] = []
        for av in app_variants_db:
            if av.previous_variant_id is None:
                app_variant = app_variant_db_to_pydantic(av)
            else:
                previous_variant = session.query(AppVariantDB).filter(AppVariantDB.id == av.previous_variant_id).first()

                if previous_variant:
                    app_variant = app_variant_db_to_pydantic(av, previous_variant.variant_name)
                else:
                    raise ValueError("Previous variant not found!!")
            app_variants.append(app_variant)

        return app_variants


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
        app_variant -- AppVariant to fetch the image for

    Returns:
        Image -- The Image associated with the app variant
    """

    with Session(engine) as session:
        db_app_variant: AppVariantDB = session.query(AppVariantDB).filter(
            (AppVariantDB.app_name == app_variant.app_name) & (AppVariantDB.variant_name == app_variant.variant_name)).order_by(AppVariantDB.version.desc()).first()
        if db_app_variant:
            image_db: ImageDB = session.query(ImageDB).filter(
                ImageDB.id == db_app_variant.image_id).first()
            return image_db_to_pydantic(image_db)
        else:
            raise Exception("App variant not found")


def remove_app_variant(app_variant: AppVariant) -> bool:
    """Remove an app variant and its associated image from the db 
    in case it is the only variant in the db using the image

    Arguments:
        app_variant -- AppVariant to remove
    Returns:
        bool -- True if the app variant was removed, False otherwise
    """

    with Session(engine) as session:
        # Find app_variant in the database
        db_app_variant: AppVariantDB = session.query(AppVariantDB).filter(
            (AppVariantDB.app_name == app_variant.app_name) & (AppVariantDB.variant_name == app_variant.variant_name)).order_by(AppVariantDB.version.desc()).first()
        if db_app_variant:
            # If it's the original variant, delete associated image
            if session.query(AppVariantDB).filter(AppVariantDB.image_id == db_app_variant.image_id).count() == 1:
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
