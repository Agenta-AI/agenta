import os
import json
from typing import List

from fastapi import HTTPException, APIRouter

from agenta_backend.models.api.evaluation_model import (
    Evaluator
)

router = APIRouter()

@router.get("/", response_model=List[Evaluator])
async def get_evaluators():
    """Fetches a list of evaluators from the hardcoded JSON file.

    Returns:
        List[Evaluator]: A list of evaluator objects.
    """

    file_path = 'agenta_backend/resources/evaluators/evaluators.json'

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Evaluators file not found")

    try:
        with open(file_path, 'r') as file:
            evaluators = json.load(file)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading evaluators file: {str(e)}")

    return evaluators