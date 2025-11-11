from oss.src.core.shared.dtos import Status


class SuccessStatus(Status):
    code: int = 200


class HandlerNotFoundStatus(Status):
    code: int = 501
    type: str = "https://docs.agenta.ai/errors#v1:uri:handler-not-found"

    def __init__(self, uri: str):
        super().__init__()
        self.message = f"The handler at '{uri}' is not implemented or not available."
