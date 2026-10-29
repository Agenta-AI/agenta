# Channels PostgreSQL process checks

Run only against a disposable PostgreSQL test server. These scripts create a separate `channels_parent_replica` schema with minimal project records and the production Channels/session table definitions. They use the production DAOs and approval service. They do not migrate an application database or call Slack, Telegram, or a runner.

From `api/`, set `CHANNELS_TEST_POSTGRES_URI` to the SQLAlchemy asyncpg URI for that isolated server, then run:

```sh
PYTHONPATH=. .venv/bin/python oss/tests/manual/channels_replica/thread_check.py
PYTHONPATH=. .venv/bin/python oss/tests/manual/channels_replica/approval_check.py
PYTHONPATH=. .venv/bin/python oss/tests/manual/channels_replica/event_check.py
```

The checks use separate Python processes. Thread creation tests four simultaneous calls with both non-null and null conversation keys, then closes a thread and verifies one replacement session. Approval admission tests two identical and two contradictory answers against real PostgreSQL; its delivery adapter is simulated, so it establishes one durable continuation, not live runner execution. Event admission tests duplicate provider records and trigger deduplication, plus conditional clearing of an old approval card. Each run creates unique project records and leaves evidence available for inspection.

To reproduce the original thread defect, set `CHANNELS_REPRO_BASELINE=1` for the thread script. It loads the DAO from commit `cf84446c349d0ae8df21f6dac65d31db52fa36ff` in each child process. This option requires that commit locally and reports the distinct session count instead of asserting the fix.

These checks do not establish outbox delivery safety with multiple workers or recovery after interrupted delivery.
