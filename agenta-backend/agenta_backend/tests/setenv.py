import os
import configparser

def setup_pytest_variables():
    config = configparser.ConfigParser()
    config.read("./agenta_backend/pytest.ini")

    for section in config.sections():
        for key, value in config[section].items():
            print("\nSetting Pytest environment variables:")
            print("KEY:", key.upper(), "VALUE:", value)
            os.environ[key.upper()] = value
