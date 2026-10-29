"""Refusals of the account choices routes. `code` is stable for clients; `message` is
for the person."""


class AccountChoicesError(Exception):
    code = "account_choices_error"

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


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
