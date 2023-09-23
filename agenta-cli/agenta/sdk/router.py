from fastapi import APIRouter
from .context import get_contexts

router = APIRouter()


@router.get("/contexts/")
def get_all_contexts():
    contexts = get_contexts()
    return {"contexts": contexts}


@router.get("/health/")
def health():
    return "OK"
