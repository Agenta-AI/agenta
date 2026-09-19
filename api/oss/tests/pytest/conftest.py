from utils.env import ag_env  # noqa: F401
from utils.egress import secure_egress_by_default  # noqa: F401
from utils.api import (
    admin_api,  # noqa: F401
    authed_api,  # noqa: F401
    unauthed_api,  # noqa: F401
)
from utils.accounts import (
    foo_account,  # noqa: F401
    cls_account,  # noqa: F401
    mod_account,  # noqa: F401
)


import os

from oss.tests.pytest.utils.postgres import (
    DECLARED_ABSENCE_REASON,
    declares_no_database,
    forget_this_runs_verdicts,
)


def pytest_sessionfinish(session, exitstatus):
    """Take this run's deployment-identity verdict files back out of the temp directory."""
    forget_this_runs_verdicts()


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    """Say how much of the run did not happen, where a deployment declared no database.

    The declaration keeps the check green on purpose, and a green check whose 111 skips are
    buried in a fold reads as a suite that ran. So the count comes out where it cannot be
    missed: the last lines of stdout, and the job summary GitHub renders above the log.

    Nothing is written when nothing was declared, so an ordinary run is unchanged.
    """
    if not declares_no_database():
        return
    # `pytest.ini` runs `-n auto`, and this hook fires in every worker as well as in the
    # controller. Each worker sees only its own share, so without this the summary collected
    # twenty partial counts and the reader had to add them up to learn what the last line
    # already said. Workers carry `workerinput`; the controller does not.
    if hasattr(config, "workerinput"):
        return

    skipped = [
        report
        for report in terminalreporter.stats.get("skipped", [])
        if DECLARED_ABSENCE_REASON in str(getattr(report, "longrepr", ""))
    ]
    if not skipped:
        return

    line = (
        f"{len(skipped)} database-bound cases were skipped: "
        "the deployment under test declares no database access "
        "(AGENTA_TEST_NO_DATABASE). They did not run."
    )
    terminalreporter.write_sep("=", "declared skips")
    terminalreporter.write_line(line)

    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if not summary:
        return
    try:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(f"\n**{line}**\n")
    except OSError:
        # A summary that cannot be written is not worth failing a run over; the line is on
        # stdout either way.
        pass
