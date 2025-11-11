from typing import Callable
from asyncio import sleep

from pydantic import BaseModel


class MockMessageModel(BaseModel):
    content: str


class MockChoiceModel(BaseModel):
    message: MockMessageModel


class MockResponseModel(BaseModel):
    choices: list[MockChoiceModel]


def hello_mock_response(*args, **kwargs) -> MockResponseModel:
    return MockResponseModel(
        choices=[
            MockChoiceModel(
                message=MockMessageModel(
                    content="world",
                )
            )
        ],
    )


def chat_mock_response(*args, **kwargs) -> MockResponseModel:
    return MockResponseModel(
        choices=[
            MockChoiceModel(
                message=MockMessageModel(
                    content="world",
                    role="assistant",
                )
            )
        ],
    )


def delay_mock_response(*args, **kwargs) -> MockResponseModel:
    sleep(2)

    return MockResponseModel(
        choices=[
            MockChoiceModel(
                message=MockMessageModel(
                    content="delay",
                )
            )
        ],
    )


MOCKS: dict[str, Callable[..., MockResponseModel]] = {
    "hello": hello_mock_response,
    "chat": chat_mock_response,
    "delay": delay_mock_response,
}
