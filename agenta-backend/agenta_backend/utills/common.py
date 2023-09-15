import secrets


def generate_invitation_token(token_length: int = 16):
    token = secrets.token_urlsafe(token_length)
    return token
