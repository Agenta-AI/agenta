"""Refusals of the account choices routes. `code` is stable for clients; `message` is
for the person."""


class AccountChoicesError(Exception):
    code = "account_choices_error"

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class AccountDataUnreadable(AccountChoicesError):
    """A stored account row the resolution cannot read (a grant that does not decrypt,
    or not as JSON). The run leaves its "user" items out."""

    code = "account_data_unreadable"

    def __init__(self) -> None:
        super().__init__("A stored account could not be read.")


class AccountStorageError(AccountChoicesError):
    """An unexpected database error in the resolution. Raised `from None`: the statement
    binds the data encryption key, so the driver error must not travel."""

    code = "account_storage_error"

    def __init__(self) -> None:
        super().__init__("The accounts could not be read.")


class AccountNotYours(AccountChoicesError):
    code = "account_not_yours"

    def __init__(self) -> None:
        super().__init__("Pick one of your own accounts.")


class AccountNotForItem(AccountChoicesError):
    code = "account_not_for_item"

    def __init__(self) -> None:
        super().__init__("This account does not fit this item.")


class ChoiceNotSupported(AccountChoicesError):
    code = "choice_not_supported"

    def __init__(self) -> None:
        super().__init__("You cannot pick an account for this item.")
