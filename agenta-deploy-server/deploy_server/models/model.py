from pydantic import BaseModel
from typing import List


class Model(BaseModel):
    model_name: str
    tag: str
    # Define image representation in API

# Add LiteSQL model for image representation in the database
