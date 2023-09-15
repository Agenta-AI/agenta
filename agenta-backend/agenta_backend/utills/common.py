import string
import secrets


def generate_invitation_token(token_length: int = 16):
    characters = string.ascii_letters + string.digits
    token = "".join(secrets.choice(characters) for _ in range(token_length))
    return token
