import os
import re

from utils.env import ag_env  # noqa: F401
from utils.api import (
    unauthed_services_api,  # noqa: F401
    services_api,  # noqa: F401
    mod_api,  # noqa: F401
    mod_services_api,  # noqa: F401
)
from utils.accounts import (
    foo_account,  # noqa: F401
    cls_account,  # noqa: F401
    mod_account,  # noqa: F401
)
from utils.gateways import (
    llm_gateway_plane,  # noqa: F401
)

# The method and path out of a misrouted-request warning, so the summary lists the routes
# rather than four copies of the same sentence.
_ROUTE = re.compile(r"MisroutedRequestWarning: (\w+ \S+) was answered")


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    """Count the requests that were answered by something other than the services app.

    The retry in `utils/api.py` exists so one misrouted request does not fail a run, and
    that is exactly why the count has to come out where it cannot be missed: a green run
    that retried its way past a routing defect otherwise reads as a run that tested the
    services app. The last lines of stdout and the job summary GitHub renders above the
    log are the two places a reader actually looks.

    Nothing is written when nothing was misrouted, so an ordinary run is unchanged.
    """
    # `pytest.ini` runs `-n auto`. Workers forward their warnings to the controller, which
    # is where the total lives; a worker printing its own share would report the count
    # several times over, each one wrong.
    if hasattr(config, "workerinput"):
        return

    # A `WarningReport` carries the formatted warning as text, category name included, so
    # the category is matched by name rather than by type.
    reported = [
        str(record.message)
        for record in terminalreporter.stats.get("warnings", [])
        if "MisroutedRequestWarning:" in str(getattr(record, "message", ""))
    ]
    if not reported:
        return

    line = (
        f"{len(reported)} request(s) were answered by something other than the services "
        "app and had to be retried. A green run does not mean those paths routed."
    )
    terminalreporter.write_sep("=", "misrouted requests")
    terminalreporter.write_line(line)
    for route in sorted(
        {match.group(1) for match in _ROUTE.finditer("\n".join(reported))}
    ):
        terminalreporter.write_line(f"  {route}")

    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if not summary:
        return
    try:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(f"\n**{line}**\n")
    except OSError:
        # A summary that cannot be written is not worth failing a run over; the line is
        # on stdout either way.
        pass
