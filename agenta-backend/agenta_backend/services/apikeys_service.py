from typing import Dict
from datetime import datetime
from agenta_backend.services.db_mongo import apikeys
from agenta_backend.models.api.apikeys_models import OpenAIAPIKey
from agenta_backend.services.aes_encryption import Encryption


async def save_apikey(payload: OpenAIAPIKey) -> Dict:
    """Encrypt and save the user openai apikey

    Arguments:
        payload (OpenAIAPIKey): The schema payload used to save the apikey
    """
    enc_apikey, iv = Encryption(payload.api_key).encrypt()
    apikey = await apikeys.find_one({"user_id": payload.user_id})
    if apikey is not None:
        # update api key
        updated_payload = {
            "api_key": enc_apikey,
            "iv_key": iv,
            "updated_at": datetime.utcnow(),
        }
        apikey = await update_apikey(payload.user_id, updated_payload)
        return apikey
    else:
        # save api key
        updated_payload = {
            "user_id": payload.user_id,
            "api_key": enc_apikey,
            "iv_key": iv,
            "created_at": datetime.utcnow(),
            "updated_at": None,
        }
        apikey = await apikeys.insert_one(updated_payload)
        return apikey


async def update_apikey(user_id: str, values: dict) -> Dict:
    """Update user openai apikey

    Arguments:
        user_id (str): The user unique idenitifier
        values (dict): The values to update

    Returns:
        Dict: user openai
    """

    key = await apikeys.update_one({"user_id": user_id}, {"$set": values})
    return key


async def remove_apikey(user_id: str) -> None:
    """Remove user openai apikey

    Arguments:
        user_id (str): The user unique idenitifier
    """
    key = await apikeys.find_one({"user_id": user_id})
    if key is not None:
        updated_payload = {
            "api_key": None,
            "updated_at": datetime.utcnow(),
        }
        await update_apikey(user_id, updated_payload)


async def get_apikey(user_id: str) -> str:
    """Retrieve user openai apikey

    Arguments:
        user_id (str): The user unique idenitifier

    Returns:
        str: the decrypted openai apikey
    """
    key = await apikeys.find_one({"user_id": user_id})
    if key["api_key"] is None:
        return ""
    decrypt_key = Encryption(key["api_key"]).decrypt(key["iv_key"])
    return decrypt_key
