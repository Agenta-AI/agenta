import os
from .utils.globals import set_global


class AgentaSingleton:
    """Singleton class to save all the "global variables" for the sdk."""

    _instance = None
    setup = None
    config = None

    def __new__(cls):
        if not cls._instance:
            cls._instance = super(AgentaSingleton, cls).__new__(cls)
        return cls._instance

    def init(self, app_name=None, variant_name=None, **kwargs):
        """Main function to initialize the singleton.

        Args:
            app_name: _description_. Defaults to None.
            variant_name: _description_. Defaults to None.
        """
        if app_name is None:
            app_name = os.environ.get("AGENTA_APP_NAME")
        if variant_name is None:
            variant_name = os.environ.get("AGENTA_VARIANT_NAME")
        self.setup = AgentaSetup(app_name=app_name, variant_name=variant_name, **kwargs)
        self.config = Config(app_name=app_name, variant_name=variant_name)


class Config:
    def __init__(self, app_name=None, variant_name=None):
        self.app_name = app_name
        self.variant_name = variant_name

    def default(self, **kwargs):
        """Saves the default parameters to the app_name and variant_name in case they are not alredy saved.
        Args:
            **kwargs: A dict containing the parameters
        """
        # TODO: Check whether there is an older version of these paramters for the same app_name and variant_name
        pass
        # TODO: remove this part and instead use the pull function in the future
        # ( For now we are setting the default values directly)
        self.push(config_name="default", overwrite=False, **kwargs)
        self.set(
            **kwargs
        )  # In case there is no connectivity, we still can use the default values

    def push(self, config_name: str, overwrite=True, **kwargs):
        """Pushes the parameters for the app variant to the server
        Args:
            config_name: Name of the configuration to push to
            overwrite: Whether to overwrite the existing configuration or not
            **kwargs: A dict containing the parameters
        """
        pass

    def pull(self, config_name: str = None):
        """Pulls the parameters for the app variant from the server"""
        pass

    def all(self):
        """Returns all the parameters for the app variant"""
        return {
            k: v
            for k, v in self.__dict__.items()
            if k not in ["app_name", "variant_name"]
        }

    # function to set the parameters for the app variant
    def set(self, **kwargs):
        """Sets the parameters for the app variant

        Args:
            **kwargs: A dict containing the parameters
        """
        for key, value in kwargs.items():
            setattr(self, key, value)


class AgentaSetup:
    """Saves the setup of the LLM app (app_name, variant_name, etc.)"""

    def __init__(self, app_name=None, variant_name=None, **kwargs):
        self.app_name = app_name
        self.variant_name = variant_name
        for key, value in kwargs.items():
            setattr(self, key, value)


def init(app_name=None, variant_name=None, **kwargs):
    """Main function to be called by the user to initialize the sdk.

    Args:
        app_name: _description_. Defaults to None.
        variant_name: _description_. Defaults to None.
    """
    singleton = AgentaSingleton()
    singleton.init(app_name=app_name, variant_name=variant_name, **kwargs)
    set_global(setup=singleton.setup, config=singleton.config)
