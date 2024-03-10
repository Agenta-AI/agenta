# Stdlib Imports
import queue
import asyncio
import threading
from logging import Logger
from typing import Coroutine, Optional, Union
from concurrent.futures import ThreadPoolExecutor, Future

# Own Imports
from agenta.client.backend.types.error import Error


class AsyncTask(object):
    """Wraps a coroutine (an asynchronous function defined with async def).

    Args:
        coroutine (Coroutine): asynchronous function
    """

    def __init__(self, coroutine: Coroutine):
        self.coroutine = coroutine
        self.task: Optional[asyncio.Task] = None

    async def run(self) -> Union[asyncio.Task, Error]:
        """Creates an asyncio Task from the coroutine and starts it

        Returns:
            Task: asyncio task
        """

        try:
            self.task = asyncio.create_task(self.coroutine)
        except Exception as exc:
            return Error(message="error running task", stacktrace=str(exc))
        return await self.task

    def cancel(self):
        """
        Cancels running asyncio Task.
        """

        if self.task:
            self.task.cancel()


class TaskQueue(object):
    """Stores a list of AsyncTask instances.

    Args:
        tasks (List[AsyncTasks]): list of async task instances

    Example Usage:
        ```python
        queue = TaskQueue()
        queue.add_task(long_running_task(1))
        queue.add_task(long_running_task(2))
        ```
    """

    def __init__(self, num_workers: int, logger: Logger):
        self.tasks = queue.Queue()  # type: ignore
        self._lock = threading.Lock()
        self._logger = logger
        self._thread_pool = ThreadPoolExecutor(max_workers=num_workers)

    def add_task(self, coroutine: Coroutine) -> AsyncTask:
        """Adds a new task to be executed.

        Args:
            coroutine (Coroutine): async task

        Returns:
            AsyncTask: task to be executed
        """

        task = AsyncTask(coroutine)
        with self._lock:
            self.tasks.put(task)
        return task

    def _worker(self):
        """
        Runs task gotten from the queue in a thread pool.
        """

        while True:
            with self._lock:
                task = self.tasks.get()
            try:
                self._logger.info(f"Running LLM tracing: {str(task)}")
                future = self._thread_pool.submit(asyncio.run, task.run())
                future.add_done_callback(self._handle_task_completion)
            except Exception as exc:
                self._logger.error(f"Error running task: {exc}")
            finally:
                self.tasks.task_done()
                self._logger.info(f"Tracing completed: {str(task)}")

    def _handle_task_completion(self, future: Future):
        """Handles task completion or exception raise.

        Args:
            future (Future): asynchronous task in progress
        """

        try:
            future.result()
        except Exception as exc:
            self._logger.error(f"Error in completed task: {exc}")
