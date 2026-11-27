import {CaretTurnDemo} from "../micro/CaretTurnDemo"
import {CopyFeedbackDemo} from "../micro/CopyFeedbackDemo"
import {ExpandRowDemo} from "../micro/ExpandRowDemo"
import {InstantOpenDemo} from "../micro/InstantOpenDemo"
import {OptimisticToggleDemo} from "../micro/OptimisticToggleDemo"
import {OverlayOriginDemo} from "../micro/OverlayOriginDemo"
import type {RuleExample} from "../types"

export const microRules: RuleExample[] = [
    {
        id: "MICRO-01",
        do: {
            example: <CaretTurnDemo turns />,
            caption: "Click Sort: the caret turns up while the menu is open.",
            code: `<Button variant="outline">\n    Sort\n    <CaretDownIcon className="ag-caret" />\n</Button>`,
        },
        avoid: {
            example: <CaretTurnDemo turns={false} />,
            caption: "Click Sort: the caret points down while the menu is already open.",
        },
    },
    {
        id: "MICRO-02",
        do: {
            example: <OverlayOriginDemo fromTrigger />,
            caption: "The panel unfolds down out of the button.",
        },
        avoid: {
            example: <OverlayOriginDemo fromTrigger={false} />,
            caption: "The panel grows from its own middle, with no link to the button.",
        },
    },
    {
        id: "MICRO-03",
        do: {
            example: <CopyFeedbackDemo inPlace />,
            caption: "Click Copy: the icon becomes a check, then goes back.",
        },
        avoid: {
            example: <CopyFeedbackDemo inPlace={false} />,
            caption: "Click Copy: a note shows up in another corner.",
        },
    },
    {
        id: "MICRO-04",
        do: {
            example: <InstantOpenDemo instant />,
            caption: "Click Search: the panel is there at once.",
        },
        avoid: {
            example: <InstantOpenDemo instant={false} />,
            caption: "Click Search: the panel takes its time to arrive.",
        },
    },
    {
        id: "MICRO-05",
        do: {
            example: <OptimisticToggleDemo optimistic />,
            caption: "Click the switch: it slides and the row says when it runs.",
        },
        avoid: {
            example: <OptimisticToggleDemo optimistic={false} />,
            caption: "Click the switch: a spinner, then the switch moves a second later.",
        },
    },
    {
        id: "MICRO-06",
        do: {
            example: <ExpandRowDemo turns />,
            caption: "Click the step: the caret turns down to the arguments it opened.",
            code: `<CollapseCaret open={open} />`,
        },
        avoid: {
            example: <ExpandRowDemo turns={false} />,
            caption:
                "Click the step: the caret still points right while the content is open below.",
        },
    },
]
