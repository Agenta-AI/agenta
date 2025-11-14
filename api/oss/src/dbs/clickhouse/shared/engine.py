import asyncio
from typing import Any, Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor

try:
    from clickhouse_driver import Client
except ImportError:
    raise ImportError(
        "clickhouse-driver is not installed. "
        "Please install it with: pip install clickhouse-driver"
    )

from oss.src.dbs.clickhouse.shared.config import (
    CLICKHOUSE_HOST,
    CLICKHOUSE_PORT,
    CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD,
    CLICKHOUSE_DATABASE,
)


class ClickHouseEngine:
    """ClickHouse async engine wrapper for executing queries."""

    def __init__(self) -> None:
        self.host = CLICKHOUSE_HOST
        self.port = CLICKHOUSE_PORT
        self.user = CLICKHOUSE_USER
        self.password = CLICKHOUSE_PASSWORD
        self.database = CLICKHOUSE_DATABASE

        # Initialize ClickHouse client
        self.client = Client(
            host=self.host,
            port=self.port,
            user=self.user,
            password=self.password,
            database=self.database,
            settings={"use_numpy": False},
        )

        # Thread pool for running blocking operations
        self.executor = ThreadPoolExecutor(max_workers=10)

    async def execute(
        self,
        query: str,
        params: Optional[List[Any]] = None,
        with_column_types: bool = False,
    ) -> Any:
        """
        Execute a query asynchronously.

        Args:
            query: SQL query to execute
            params: Query parameters (for parameterized queries)
            with_column_types: If True, return column types along with data

        Returns:
            Query result
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            self.executor,
            lambda: self._execute_blocking(
                query, params, with_column_types
            ),
        )

    def _execute_blocking(
        self,
        query: str,
        params: Optional[List[Any]] = None,
        with_column_types: bool = False,
    ) -> Any:
        """Execute query in blocking mode (called in thread pool)."""
        if params:
            return self.client.execute(
                query,
                params,
                with_column_types=with_column_types,
            )
        else:
            return self.client.execute(
                query,
                with_column_types=with_column_types,
            )

    async def execute_insert(
        self, table: str, data: List[Dict[str, Any]]
    ) -> None:
        """
        Execute an INSERT operation asynchronously.

        Args:
            table: Table name
            data: List of dictionaries to insert
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            self.executor,
            lambda: self._execute_insert_blocking(table, data),
        )

    def _execute_insert_blocking(
        self, table: str, data: List[Dict[str, Any]]
    ) -> None:
        """Execute insert in blocking mode (called in thread pool)."""
        if not data:
            return

        # Get column names from first row
        columns = list(data[0].keys())
        # Convert list of dicts to list of tuples
        values = [[row.get(col) for col in columns] for row in data]

        insert_query = (
            f"INSERT INTO {table} ({', '.join(columns)}) VALUES"
        )
        self.client.execute(insert_query, values)

    async def execute_delete(self, query: str) -> None:
        """
        Execute a DELETE operation asynchronously (using ALTER TABLE DELETE).

        Args:
            query: DELETE query
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            self.executor,
            lambda: self._execute_delete_blocking(query),
        )

    def _execute_delete_blocking(self, query: str) -> None:
        """Execute delete in blocking mode (called in thread pool)."""
        self.client.execute(query)

    async def close(self) -> None:
        """Close the ClickHouse client and thread pool."""
        self.executor.shutdown(wait=True)

    async def init_db(self) -> None:
        """Initialize database connection (no-op for ClickHouse)."""
        pass

    async def close_db(self) -> None:
        """Close database connection."""
        await self.close()


# Global engine instance
engine = ClickHouseEngine()
