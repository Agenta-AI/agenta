from sqlmodel import Session, SQLModel, create_engine
from deploy_server.models.api_models import AppVersion, Image
from deploy_server.models.db_models import AppVersionDB, ImageDB
from deploy_server.models.converters import app_version_db_to_pydantic, image_db_to_pydantic
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


def add_app_version(app_version: AppVersion, image: Image):
    """Adds a new app version to the db. 
    First adds an app version, then adds the image to the db and links it to the app version

    Arguments:
        app_version -- AppVersion to add
        image -- The Image associated with the app version
    """
    with Session(engine) as session:
        # Add image
        db_image = ImageDB(**image.dict())
        session.add(db_image)
        session.commit()
        session.refresh(db_image)
        # Add app version and link it to the app version
        db_app_version = AppVersionDB(
            image_id=db_image.id, **app_version.dict())
        session.add(db_app_version)
        session.commit()
        session.refresh(db_app_version)


def list_app_versions() -> List[AppVersion]:
    """
    Lists all the app versions from the db"""

    with Session(engine) as session:
        app_versions_db: List[AppVersionDB] = session.query(AppVersionDB).all()
        return [app_version_db_to_pydantic(av) for av in app_versions_db]


def get_image(app_version: AppVersion) -> Image:
    """Returns the image associated with the app version

    Arguments:
        app_version -- _description_

    Returns:
        _description_
    """

    with Session(engine) as session:
        db_app_version: AppVersionDB = session.query(AppVersionDB).filter(
            AppVersionDB.id == app_version.id).first()
        if db_app_version:
            image_db: ImageDB = session.query(ImageDB).filter(
                ImageDB.id == db_app_version.image_id).first()
            return image_db_to_pydantic(image_db)
        else:
            raise Exception("App version not found")


def remove_app_version(app_version: AppVersion) -> bool:
    """Remove an app version and its associated image from the db 

    Arguments:
        app_version -- _description_
    Returns:
        bool -- True if the app version was removed, False otherwise
    """

    with Session(engine) as session:
        # Find app_version in the database
        db_app_version: AppVersionDB = session.query(AppVersionDB).filter(
            AppVersionDB.id == app_version.id).first()
        if db_app_version:
            # Delete associated image
            db_image: ImageDB = session.query(ImageDB).filter(
                ImageDB.id == db_app_version.image_id).first()
            if db_image:
                session.delete(db_image)
            else:
                raise Exception("Image for app not found")

            # Delete app_version
            session.delete(db_app_version)
            session.commit()
            return True
        else:
            return False
