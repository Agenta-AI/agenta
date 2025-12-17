"""
Example showing how to use session and actor tracking in Agenta SDK.

This example demonstrates:
1. Setting session_id and session_type for grouping related requests
2. Setting actor_id and actor_type for tracking users/entities
3. Propagating these attributes via OpenTelemetry baggage
"""

import agenta as ag

# Initialize Agenta SDK
ag.init(api_key="your-api-key-here", host="https://cloud.agenta.ai")


@ag.instrument()
async def process_chat_message(message: str, user_id: str):
    """Process a single chat message."""
    # Set session and actor information on the current span
    ag.tracing.store_session(
        session_id="chat-session-123",
        session_type="chat",
    )

    ag.tracing.store_actor(
        actor_id=user_id,
        actor_type="person",
    )

    # Your application logic here
    response = f"Echo: {message}"

    return response


@ag.instrument()
async def chat_workflow():
    """Example workflow showing session tracking across multiple calls."""
    # All nested calls will inherit the session/actor from baggage
    await process_chat_message("Hello!", "user-456")
    await process_chat_message("How are you?", "user-456")
    await process_chat_message("Goodbye!", "user-456")


# Example with baggage propagation via HTTP headers
def example_with_baggage_headers():
    """
    When calling Agenta endpoints (chat/completion), you can pass session/actor
    information via the Baggage header.

    The Baggage header format follows W3C specification:
    Baggage: ag.session.id=chat-session-123,ag.session.type=chat,ag.actor.id=user-456,ag.actor.type=user
    """

    import requests

    headers = {
        "Authorization": "Bearer your-api-key",
        "Content-Type": "application/json",
        # Session and actor information in Baggage header
        "Baggage": "ag.session.id=chat-session-123,ag.session.type=chat,ag.actor.id=user-456,ag.actor.type=user",
    }

    response = requests.post(
        "https://cloud.agenta.ai/api/chat/completions",
        headers=headers,
        json={"messages": [{"role": "user", "content": "Hello!"}]},
    )

    return response.json()


if __name__ == "__main__":
    import asyncio

    # Run the example
    asyncio.run(chat_workflow())
