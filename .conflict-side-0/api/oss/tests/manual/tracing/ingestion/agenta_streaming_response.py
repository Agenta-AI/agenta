# /// script
# dependencies = ["agenta", "fastapi", "pydantic"]
# ///
"""
Simple Agenta Observability FastAPI Example

This example demonstrates the main issues with Agenta observability:
1. @ag.instrument() decorator doesn't work with generator functions (streaming responses)
2. Batch size configuration issues with OpenTelemetry environment variables

"""

from dotenv import load_dotenv

import asyncio
import json
import logging
import os
from typing import AsyncGenerator

import agenta as ag
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ISSUE: OpenTelemetry environment variables don't work because Agenta overrides them
# These standard OTEL env vars should work but don't:
os.environ["OTEL_EXPORTER_OTLP_COMPRESSION"] = "gzip"
os.environ["OTEL_BSP_MAX_EXPORT_BATCH_SIZE"] = "10"
os.environ["OTEL_BSP_MAX_QUEUE_SIZE"] = "500"
os.environ["OTEL_BSP_SCHEDULE_DELAY"] = "3000"

# Initialize Agenta
load_dotenv(override=True)

ag.init()


class StreamConfig(BaseModel):
    """Configuration for streaming responses"""

    max_tokens: int = Field(default=20, description="Maximum tokens to generate")


@ag.instrument()
async def streaming_generator_with_broken_decorator(
    text: str,
) -> AsyncGenerator[str, None]:
    config = StreamConfig()

    # The decorator will close the span here, before any yields
    logger.info("🚨 Starting generator (decorator will close span immediately)")

    words = text.split()
    for i, word in enumerate(words[: config.max_tokens]):
        token = f"{word} "
        logger.info(f"📡 Yielding: {token.strip()}")
        yield f"data: {json.dumps({'token': token, 'index': i})}\\n\\n"

    yield "data: [DONE]\\n\\n"


@ag.instrument()
async def stream_with_broken_decorator(
    text: str = "Hello world from Agenta streaming test",
):
    logger.info("🚨 Using BROKEN decorator approach")
    return StreamingResponse(
        streaming_generator_with_broken_decorator(text), media_type="text/event-stream"
    )


if __name__ == "__main__":
    import asyncio

    async def main():
        # Get the StreamingResponse object
        response = await stream_with_broken_decorator()

        # Access the streaming content from the response
        async for chunk in response.body_iterator:
            print(chunk, end="")

    asyncio.run(main())
