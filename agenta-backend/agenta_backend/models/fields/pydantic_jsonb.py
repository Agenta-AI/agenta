import json

from pydantic import ValidationError
from sqlalchemy.types import TypeDecorator
from sqlalchemy.dialects.postgresql import JSONB


class PydanticJSONB(TypeDecorator):
    """
    A custom SQLAlchemy type that accepts and validates a Pydantic model and converts it to the JSONB value \
        before inserting the data into the database, and also converts the JSONB value to Pydantic model dictionary \
            when retrieving the data from the database.

    Args:
        model (Type[BaseModel]): The Pydantic model class to use when loading data into the database.
    """

    impl = JSONB

    def __init__(self, *args, **kwargs):
        self.model = kwargs.pop("model", None)
        super().__init__(*args, **kwargs)

    def process_bind_param(self, value, dialect):
        """
        Process the bind parameter before it is sent to the database.

        Args:
            value (Any): The value to be processed.
            dialect (str): The dialect of the database.

        Returns:
            str: The processed pydantic model as a JSON string.

        Raises:
            ValueError: If the JSON data is invalid.
        """

        if self.model and value is not None:
            try:
                if isinstance(value, list):
                    value = self.model.parse_obj(
                        value
                    ).dict()  # this is for the case where we need to validate a list of pydantic model
                else:
                    value = self.model(
                        **value
                    ).dict()  # this is for the case where we need to validate a single pydantic model
            except (ValidationError, ValueError) as e:
                raise Exception(f"Invalid JSON data: {str(e)}")
            except Exception as e:
                raise Exception(
                    f"Value is not of type '{self.model.__name__}': {str(e)}"
                )
        return json.dumps(value)

    def process_result_value(self, value, dialect):
        """
        Process the result value from the database.

        Args:
            value (str): The value retrieved from the database.
            dialect (str): The dialect of the database.

        Returns:
            Any: The processed value as a Python object. If the value is not None, it is parsed as JSON and returned.
        """

        if value is not None:
            value = json.loads(value)
        return value
