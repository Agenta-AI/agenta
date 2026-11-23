import {CaretTurnDemo} from "../micro/CaretTurnDemo"
import {CopyFeedbackDemo} from "../micro/CopyFeedbackDemo"
import {ExpandRowDemo} from "../micro/ExpandRowDemo"
import {InstantOpenDemo} from "../micro/InstantOpenDemo"
import {OptimisticToggleDemo} from "../micro/OptimisticToggleDemo"
import {OverlayOriginDemo} from "../micro/OverlayOriginDemo"
import type {GuideRule} from "../types"

export const microRules: GuideRule[] = [
    {
        id: "MICRO-01",
        title: "A caret shows where its panel is",
        why: "A caret on a trigger says a panel opens there. While the panel is open, the caret turns 180° and points back at the trigger; when it closes, it turns back. Select and Combobox do this already. On any other trigger, add ag-caret to the caret.",
        do: {
            example: <CaretTurnDemo turns />,
            caption: "Click Sort: the caret turns up while the menu is open.",
            code: `<Button variant="outline">\n    Sort\n    <CaretDownIcon className="ag-caret" />\n</Button>`,
        },
        avoid: {example: <CaretTurnDemo turns={false} />, caption: "Click Sort: the caret points down while the menu is already open."},
        checkedBy: ["review"],
    },
    {
        id: "MICRO-02",
        title: "Overlays unfold from what opened them",
        why: "A menu or popover that grows out of its trigger shows where it came from and where it will go back to. The kit's Popover, DropdownMenu and HoverCard do this with ag-overlay-motion. Only dialogs open from the center of the window.",
        do: {example: <OverlayOriginDemo fromTrigger />, caption: "The panel unfolds down out of the button."},
        avoid: {example: <OverlayOriginDemo fromTrigger={false} />, caption: "The panel grows from its own middle, with no link to the button."},
        checkedBy: ["review"],
    },
    {
        id: "MICRO-03",
        title: "The control answers in its own place",
        why: "The person is looking at what they clicked, so the answer goes there: Copy becomes Check for 1.5s, a switch slides, the send arrow becomes Stop. A toast or a banner somewhere else makes the eye leave the work.",
        do: {example: <CopyFeedbackDemo inPlace />, caption: "Click Copy: the icon becomes a check, then goes back."},
        avoid: {example: <CopyFeedbackDemo inPlace={false} />, caption: "Click Copy: a note shows up in another corner."},
        checkedBy: ["review"],
    },
    {
        id: "MICRO-04",
        title: "No animation on things used many times an hour",
        why: "The command palette and keyboard shortcuts are used all day. Any animation there makes the person wait, again and again. They open at once.",
        do: {example: <InstantOpenDemo instant />, caption: "Click Search: the panel is there at once."},
        avoid: {example: <InstantOpenDemo instant={false} />, caption: "Click Search: the panel takes its time to arrive."},
        checkedBy: ["review"],
    },
    {
        id: "MICRO-05",
        title: "A toggle shows its new state on the click",
        why: "When a person turns an automation on, the switch slides and the line under the name changes at once. The call to the server runs behind it; the switch goes back only if the call fails, with the error next to it. Waiting for the server first makes every click feel slow.",
        do: {example: <OptimisticToggleDemo optimistic />, caption: "Click the switch: it slides and the row says when it runs."},
        avoid: {example: <OptimisticToggleDemo optimistic={false} />, caption: "Click the switch: a spinner, then the switch moves a second later."},
        checkedBy: ["review"],
    },
    {
        id: "MICRO-06",
        title: "An expanding row points at what it opened",
        why: "A step in a session, a folder in a tree or a sidebar group opens below itself. Its right caret turns 90° to point down at the new content, and turns back when it closes. Use CollapseCaret: Phosphor's regular CaretRight, never a filled triangle. It does the turn and stops it under reduced motion.",
        do: {
            example: <ExpandRowDemo turns />,
            caption: "Click the step: the caret turns down to the arguments it opened.",
            code: `<CollapseCaret open={open} />`,
        },
        avoid: {example: <ExpandRowDemo turns={false} />, caption: "Click the step: the caret still points right while the content is open below."},
        checkedBy: ["review"],
    },
]
