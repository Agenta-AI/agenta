# Stdlib Imports
import asyncio
from functools import partial
from typing import Callable, Coroutine


async def run_in_separate_thread(func: Callable, *args, **kwargs) -> Coroutine:
    """
    Run a synchronous function in a separate thread.

    Args:
        func (callable): The synchronous function to be executed.
        args (tuple): Positional arguments to be passed to `func`.
        kwargs (dict): Keyword arguments to be passed to `func`.

    Returns:
        The result of the synchronous function.
    """

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(func, *args, **kwargs))
