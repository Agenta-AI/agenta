from http import HTTPStatus

from fastapi import HTTPException


def code_to_phrase(status_code: int) -> str:
    try:
        return HTTPStatus(status_code).phrase
    except ValueError:
        return "Unknown Status Code"


class BadRequestException(HTTPException):
    def __init__(
        self,
        code: int = 400,
        detail: str = "Bad Request",
    ):
        self.code = code
        self.detail = detail

        super().__init__(self.code, self.detail)


class UnauthorizedException(HTTPException):
    def __init__(
        self,
        code: int = 401,
        detail: str = "Unauthorized",
    ):
        self.code = code
        self.detail = detail

        super().__init__(self.code, self.detail)


class ForbiddenException(HTTPException):
    def __init__(
        self,
        code: int = 403,
        detail: str = "Fordidden",
    ):
        self.code = code
        self.detail = detail

        super().__init__(self.code, self.detail)


class UnprocessableContentException(HTTPException):
    def __init__(
        self,
        code: int = 422,
        detail: str = "Unprocessable Content",
    ):
        self.code = code
        self.detail = detail

        super().__init__(self.code, self.detail)


class TooManyRequestsException(HTTPException):
    def __init__(
        self,
        code: int = 429,
        detail: str = "Too Many Requests",
    ):
        self.code = code
        self.detail = detail

        super().__init__(self.code, self.detail)


class InternalServerErrorException(HTTPException):
    def __init__(
        self,
        code: int = 500,
        detail: str = "Internal Server Error",
    ):
        self.code = code
        self.detail = detail

        super().__init__(self.code, self.detail)


class GatewayTimeoutException(HTTPException):
    def __init__(
        self,
        code: int = 504,
        detail: str = "Gateway Timeout",
    ):
        self.code = code
        self.detail = detail

        super().__init__(self.code, self.detail)
