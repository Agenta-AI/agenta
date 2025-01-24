from pydantic import BaseModel


class MockMessageModel(BaseModel):
    content: str


class MockChoiceModel(BaseModel):
    message: MockMessageModel


class MockResponseModel(BaseModel):
    choices: list[MockChoiceModel]


MOCKS = {
    "hello": MockResponseModel(
        choices=[
            MockChoiceModel(
                message=MockMessageModel(
                    content="world",
                )
            )
        ],
    ),
}
