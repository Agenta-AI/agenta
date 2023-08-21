import json
import base64
from typing import Any, Tuple

from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad
from Crypto.Random import get_random_bytes


encryption_key = None
with open("encryption_key.json", "r") as key_file:
    data = json.load(key_file)
    encryption_key = data.get("encryption_key")


class Encryption:
    """
    Responsible for: encryption and decrpytion of text.
    """

    def __init__(self, data: Any):
        self.data = data
        self.cbc_mode = AES.MODE_CBC
        self.bs = AES.block_size
        self.enc_key = encryption_key.encode("utf8")
        
    def encrypt(self) -> Tuple[str, bytes]:
        raw = pad(self.data.encode(), self.bs)
        iv = get_random_bytes(self.bs)
        cipher = AES.new(self.enc_key, AES.MODE_CBC, iv=iv)
        ciphertext = cipher.encrypt(raw)
        return base64.b64encode(ciphertext).decode(), iv

    def decrypt(self, iv: bytes):
        enc = base64.b64decode(self.data)
        cipher = AES.new(self.enc_key, AES.MODE_CBC, iv=iv)
        decrypted_data = unpad(cipher.decrypt(enc), self.bs)
        return decrypted_data.decode("utf-8")
