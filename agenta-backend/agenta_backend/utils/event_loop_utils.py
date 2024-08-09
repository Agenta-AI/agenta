import asyncio


def ensure_event_loop() -> asyncio.AbstractEventLoop:
    """
    Ensure that there is an event loop available in the current thread.
    If there isn't one, create a new event loop and set it.

    Raises:
        RuntimeError: There is no current event loop in thread 'AnyIO worker thread'.

    Returns:
        asyncio.AbstractEventLoop: The event loop for the current thread.
    """

    try:
        loop = asyncio.get_event_loop()
    except RuntimeError as e:
        if "There is no current event loop in thread" in str(e):
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
    return loop
