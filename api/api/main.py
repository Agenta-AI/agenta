from fastapi import FastAPI, Body, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Union, AsyncGenerator
import openai
import os
# import httpx
from api.models.model import LLMCall
from api.db import connect_to_db

connect_to_db()
app = FastAPI()

openai.api_key = os.environ.get("OPENAI_API_KEY")


class Message(BaseModel):
    role: str
    content: str
    name: Optional[str]


class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[Message]
    temperature: Optional[float]
    top_p: Optional[float]
    n: Optional[int]
    stream: Optional[bool]
    stop: Optional[Union[str, List[str]]]
    max_tokens: Optional[int]
    presence_penalty: Optional[float]
    frequency_penalty: Optional[float]
    logit_bias: Optional[Dict[str, float]]
    user: Optional[str]


@app.post("/v1/chat/completions")
async def create_chat_completion(request: ChatCompletionRequest):
    # if request.stream:
    #     return StreamingResponse(stream_openai_response(request), media_type="text/event-stream")
    # else:
    params = {
        "model": request.model,
        "messages": [{"role": msg.role, "content": msg.content, "name": msg.name} for msg in request.messages],
    }

    optional_params = [
        "temperature",
        "top_p",
        "n",
        "stream",
        "stop",
        "max_tokens",
        "presence_penalty",
        "frequency_penalty",
        "logit_bias",
        "user",
    ]

    for param in optional_params:
        value = getattr(request, param)
        if value is not None:
            params[param] = value
    print(params)
    response = openai.ChatCompletion.create(**params)
    print(response.choices[0].message.content)
    print(response)
    # class LLMCall(Document):
    #     # run = ReferenceField(Run, required=True)
    #     # prompt_template = ReferenceField(PromptTemplate, required=True)
    #     prompt = StringField(required=True)
    #     output = StringField(required=True)
    #     parameters = DictField()

    llmcall = LLMCall(prompt=request.messages,
                      output=response.choices[0].message.content)
    llmcall.save()

    return response.choices[0].message.content


# async def stream_openai_response(request: ChatCompletionRequest) -> AsyncGenerator[bytes, None]:
#     headers = {
#         "Content-Type": "application/json",
#         "Authorization": f"Bearer {openai.api_key}",
#     }
#     data = request.dict()
#     async with httpx.AsyncClient() as client:
#         async with client.stream(
#             "POST",
#             "https://api.openai.com/v1/chat/completions",
#             headers=headers,
#             json=data,
#         ) as response:
#             async for chunk in response.aiter_bytes():
#                 yield chunk
