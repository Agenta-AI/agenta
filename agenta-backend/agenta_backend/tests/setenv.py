import os
import logging
import configparser


# Initialize logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


def setup_pytest_variables():
    config = configparser.ConfigParser()
    config.read("./agenta_backend/pytest.ini")

    for section in config.sections():
        for key, value in config[section].items():
            logger.info("Setting Pytest environment variables:")
            logger.info(f"KEY: {key.upper()}, VALUE: {value}")
            os.environ[key.upper()] = value
