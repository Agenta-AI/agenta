"""The session backfill of `oss000000049` keeps one batch fast on a large table.

`oss000000048` adds `session_streams.visibility` with no statistics, so the planner
guesses that few rows are NULL. With the first turn as an inlined `DISTINCT ON`
subquery it then picks a nested loop that runs the subquery again for every row of
the batch: on 1M synthetic sessions one batch passed the 60 s statement timeout. The
revision therefore analyzes the table before the walk and reads the first turn with a
`LATERAL ... LIMIT 1` per batch row (one index read each).
"""

from oss.tests.pytest.utils.membership_seed import load_revision_module


REVISION = "oss000000049_backfill_agent_session_sharing.py"


class _Result:
    def first(self):
        return None  # the first batch is empty: the walk ends


class _RecordingConnection:
    def __init__(self):
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append(str(statement).strip())
        return _Result()


def test_the_first_turn_is_read_per_row_with_lateral_limit_1():
    sql = load_revision_module(REVISION)._BACKFILL_SESSIONS_BATCH_SQL
    assert "DISTINCT ON" not in sql
    assert "LEFT JOIN LATERAL" in sql
    assert "LIMIT 1" in sql


def test_the_walk_analyzes_session_streams_before_the_first_batch():
    module = load_revision_module(REVISION)
    connection = _RecordingConnection()
    assert module._backfill_sessions(connection) == 0
    assert connection.statements[0] == "ANALYZE session_streams"
    assert "WITH batch AS" in connection.statements[1]
