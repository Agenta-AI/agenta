"""The deployment switch for a person's own accounts.

`AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED` is off by default. While it is off, no route
reads or writes a person's rows or account choices, and a run leaves every "user" item
out. Rows stored while it was on stay stored, hidden and unused.
"""

from oss.src.utils.env import env


class PersonalAccountsDisabled(Exception):
    """A person route was called while the deployment switch is off."""

    code = "personal_accounts_disabled"

    def __init__(self) -> None:
        self.message = "Personal accounts are not available here."
        super().__init__(self.message)


def personal_accounts_enabled() -> bool:
    return env.agenta.access.personal_accounts_enabled
