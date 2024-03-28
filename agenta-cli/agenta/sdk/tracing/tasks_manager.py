# Stdlib Imports
import queue
import asyncio
import threading
from logging import Logger
from datetime import datetime
from typing import Coroutine, Optional, Union, Dict, Any
from concurrent.futures import ThreadPoolExecutor, Future

# Own Imports
from agenta.client.backend.types.error import Error
from agenta.client.backend.client import AsyncObservabilityClient


class AsyncTask(object):
    """Wraps a coroutine (an asynchronous function defined with async def).

    Args:
        coroutine (Coroutine): asynchronous function
    """

    def __init__(
        self,
        coroutine_id: str,
        coroutine_type: str,
        coroutine: Coroutine,
        client: AsyncObservabilityClient,
    ):
        self.coroutine_id = coroutine_id
        self.coroutine_type = coroutine_type
        self.coroutine = coroutine
        self.task: Optional[asyncio.Task] = None
        self.client = client

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

    def add_task(
        self,
        coroutine_id: str,
        coroutine_type: str,
        coroutine: Coroutine,
        obs_client: AsyncObservabilityClient,
    ) -> AsyncTask:
        """Adds a new task to be executed.

        Args:
            coroutine_id (str): The Id of the coroutine
            coroutine_type (str): The type of coroutine
            coroutine (Coroutine): async task
            obs_client (AsyncObservabilityClient): The async observability client

        Returns:
            AsyncTask: task to be executed
        """

        task = AsyncTask(coroutine_id, coroutine_type, coroutine, obs_client)
        self.tasks.put(task)
        return self._worker()

    def _worker(self):
        """
        Runs task gotten from the queue in a thread pool.
        """

        while True:
            task: AsyncTask = self.tasks.get()  # type: ignore
            try:
                future = self._thread_pool.submit(asyncio.run, task.run())
                future.result()
            except Exception as exc:
                self._logger.error(f"Error running task: {str(exc)}")

                self._logger.error(f"Updating {task.coroutine_type} status to FAILED.")
                self._handle_error_completion(
                    client=task.client, type=task.coroutine_type, exc=exc
                )
                break
            finally:
                self.tasks.task_done()
                break

    def _handle_error_completion(
        self, client: AsyncObservabilityClient, type: str, exc: Exception
    ):
        if type == None:
            return

        if type == "trace":
            task = client.update_trace(
                trace_id=trace,  # type: ignore
                status="FAILED",
                end_time=datetime.now(),
                outputs=[str(exc)],
            )

        future = self._thread_pool.submit(asyncio.run, task)  # type: ignore
        future.result()
