import os
import docker
from deploy_server.config import settings
from deploy_server.services.db_manager import get_session, list_app_versions

client = docker.from_env()


def test_get_session():
    assert get_session() is not None


def test_list():
    print(list_app_versions())
    assert list_app_versions() == []


if __name__ == "__main__":
    test_get_session()
    test_list()
