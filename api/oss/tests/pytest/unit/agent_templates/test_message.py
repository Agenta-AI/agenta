import pytest

from oss.src.core.agent_templates.dtos import SkipTemplateChoice
from oss.src.core.agent_templates.exceptions import TemplatePackageInvalid
from oss.src.core.agent_templates.message import compose_first_message
from oss.src.core.agent_templates.models import (
    ParsedTemplateAgent,
    ParsedTemplatePackage,
    TemplateAutomationRecipe,
    TemplateBindingPlan,
    UnresolvedTemplateBinding,
)


def _package(
    *, setup: str | None = "Read the target profile first.", automation: bool = True
):
    recipes = []
    if automation:
        recipes.append(
            TemplateAutomationRecipe(
                key="weekday-prospects",
                name="Weekday prospect research",
                required=False,
                trigger={"type": "schedule", "schedule": "0 9 * * 1-5"},
                inputs_fields={"messages": [{"role": "user", "content": "Research."}]},
                setup_notes="Confirm the timezone before activation.",
            )
        )
    return ParsedTemplatePackage(
        source={"kind": "internal", "key": "sample"},
        version="1.0.0",
        digest="sha256:" + "1" * 64,
        agent=ParsedTemplateAgent(
            key="sample",
            name="Sample",
            description="Sample agent.",
            instructions="# Sample",
            setup=setup,
            automations=recipes,
        ),
    )


def test_message_labels_package_text_and_keeps_recipe_inactive():
    initial = (
        "Build the outreach drafter.\n\n"
        "I've connected Gmail. Ask me before you write or send anything."
    )
    text = compose_first_message(
        initial_message=f"  {initial}\n",
        package=_package(),
        bindings=TemplateBindingPlan(
            unresolved=[
                UnresolvedTemplateBinding(
                    connection_key="mailbox",
                    purpose="Prepare mailbox drafts.",
                    setup_notes="Save Markdown drafts if skipped.",
                    selected_option={"kind": "skip"},
                )
            ]
        ),
        choices=[SkipTemplateChoice(connection_key="mailbox", kind="skip")],
    )

    assert text.startswith(initial)
    assert text.count("I've connected Gmail") == 1
    assert "Template-supplied setup guidance:" in text
    assert "Remaining connection setup:" in text
    assert "Automation recipe to discuss, not activate:" in text
    assert "0 9 * * 1-5" in text


def test_minimal_package_does_not_invent_setup_work():
    text = compose_first_message(
        initial_message="  Start the research.  ",
        package=_package(setup=None, automation=False),
        bindings=TemplateBindingPlan(),
        choices=[],
    )

    assert text == "Start the research."


def test_setup_can_supply_the_whole_message():
    text = compose_first_message(
        initial_message="  ",
        package=_package(automation=False),
        bindings=TemplateBindingPlan(),
        choices=[],
    )

    assert text.startswith("Template-supplied setup guidance:")


def test_message_with_no_content_is_rejected():
    with pytest.raises(TemplatePackageInvalid) as error:
        compose_first_message(
            initial_message="",
            package=_package(setup=None, automation=False),
            bindings=TemplateBindingPlan(),
            choices=[],
        )

    assert error.value.code == "first_message_empty"
