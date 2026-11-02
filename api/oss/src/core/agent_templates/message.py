import json

from oss.src.core.agent_templates.dtos import TemplateConnectionChoice
from oss.src.core.agent_templates.exceptions import TemplatePackageInvalid
from oss.src.core.agent_templates.models import (
    ParsedTemplatePackage,
    ScheduleTrigger,
    SubscriptionTrigger,
    TemplateBindingPlan,
)


def _automation_text(package: ParsedTemplatePackage) -> str | None:
    if not package.agent.automations:
        return None
    lines = ["Automation recipe to discuss, not activate:"]
    for recipe in package.agent.automations:
        if isinstance(recipe.trigger, ScheduleTrigger):
            trigger = f"schedule `{recipe.trigger.schedule}`"
        elif isinstance(recipe.trigger, SubscriptionTrigger):
            trigger = (
                f"subscription `{recipe.trigger.event_key}` using "
                f"connection `{recipe.trigger.connection}`"
            )
        else:
            continue
        required = "required by the package author" if recipe.required else "optional"
        lines.append(f"- {recipe.name} ({required}): {trigger}.")
        if recipe.setup_notes:
            lines.append(f"  Guidance: {recipe.setup_notes.strip()}")
        if recipe.inputs_fields is not None:
            payload = json.dumps(
                recipe.inputs_fields,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            lines.append(f"  Proposed inputs: `{payload}`")
    return "\n".join(lines)


def _unresolved_text(bindings: TemplateBindingPlan) -> str | None:
    if not bindings.unresolved:
        return None
    lines = ["Remaining connection setup:"]
    for item in bindings.unresolved:
        selected = item.selected_option or {}
        if selected.get("kind") == "skip":
            state = "Skipped for now."
        elif selected:
            state = "The selected option has no active, valid project connection."
        else:
            state = "No option was selected."
        lines.append(f"- {item.connection_key}: {item.purpose} {state}")
        if item.setup_notes:
            lines.append(f"  Guidance: {item.setup_notes.strip()}")
    return "\n".join(lines)


def compose_first_message(
    *,
    initial_message: str,
    package: ParsedTemplatePackage,
    bindings: TemplateBindingPlan,
    choices: list[TemplateConnectionChoice],
) -> str:
    sections: list[str] = []
    initial = initial_message.strip()
    if initial:
        sections.append(initial)
    if package.agent.setup and package.agent.setup.strip():
        sections.append(
            "Template-supplied setup guidance:\n" + package.agent.setup.strip()
        )
    if choices:
        sections.append(
            "Retained connection choices:\n"
            + "\n".join(
                f"- {choice.connection_key}: "
                + json.dumps(
                    choice.model_dump(mode="json", exclude_none=True), sort_keys=True
                )
                for choice in choices
            )
        )
    if choices or bindings.tools or bindings.mcps:
        sections.append("Ask me before you write or send anything.")
    unresolved = _unresolved_text(bindings)
    if unresolved:
        sections.append(unresolved)
    automation = _automation_text(package)
    if automation:
        sections.append(automation)
    if not sections:
        raise TemplatePackageInvalid(
            "first_message_empty",
            "The template load has no first-message content.",
        )
    return "\n\n".join(sections)
