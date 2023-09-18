import secrets
from agenta_backend.models.db_engine import DBEngine
engine = DBEngine(mode="default").engine()


def generate_invitation_token(token_length: int = 16):
    token = secrets.token_urlsafe(token_length)
    return token
