import os
import configparser

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


def setup_pytest_variables():
    config = configparser.ConfigParser()
    config.read("./src/pytest.ini")

    for section in config.sections():
        for key, value in config[section].items():
            os.environ[key.upper()] = value
