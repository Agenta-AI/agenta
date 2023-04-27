from mongoengine import connect
import os


def connect_to_db():
    mongo_uri = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/chatbot_logs")
    connect(host=mongo_uri, alias="default")
