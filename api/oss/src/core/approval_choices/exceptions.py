"""Refusals of the approval choices routes. `code` is stable for clients."""


class ApprovalChoiceNotSupported(Exception):
    code = "approval_choice_not_supported"

    def __init__(self) -> None:
        self.message = "Only the builder's tools.agenta.create_agent, tools.agenta.edit_agent_config and tools.agenta.start_session accept a choice."
        super().__init__(self.message)
