from mongoengine import connect
import os


def connect_to_db():
    mongo_uri = os.environ.get(
        "MONGODB_URI", "mongodb://username:password@mongo:27017")
    connect(host=mongo_uri, alias="default")
