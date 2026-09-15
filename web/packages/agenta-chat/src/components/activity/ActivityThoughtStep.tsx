import {useState} from "react"

import {useTypewriter} from "../../hooks/useTypewriter"
import RevealCollapse from "../RevealCollapse"

import {ActivityNode, LIVE_TEXT_CLASS, StepCaret, StepRow} from "./activityIcons"

/** Streams the text only while a step is live; a settled thought is plain text. */
const LiveText = ({text, urgent}: {text: string; urgent?: boolean}) => {
    const {text: revealed} = useTypewriter(text, {urgent})
    return <>{revealed}</>
}

/** A thought on the timeline, shaped like a tool row: first line beside the node, the rest a tap away. */
export const ActivityThoughtStep = ({
    text,
    streaming,
    urgent,
    live,
}: {
    text: string
    streaming: boolean
    /** Reveal faster: an earlier thought while a later part is already arriving. */
    urgent?: boolean
    /** The run's latest step while the run goes on: it reads live even once written out. */
    live?: boolean
}) => {
    const [open, setOpen] = useState(false)
    // The row types along; the expanded copy stays plain so a thought never runs two frame loops.
    const line = streaming ? <LiveText text={text} urgent={urgent} /> : text
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <StepRow open={open} onToggle={() => setOpen((v) => !v)}>
                <ActivityNode icon="brain" />
                <span
                    className={`min-w-0 max-w-[44ch] truncate text-sm text-colorTextSecondary transition-colors group-hover/row:text-colorText ${
                        live || streaming ? LIVE_TEXT_CLASS : ""
                    }`}
                >
                    {line}
                </span>
                <StepCaret open={open} />
            </StepRow>
            <RevealCollapse open={open}>
                <div className="whitespace-pre-wrap break-words pl-[38px] text-[13px] italic leading-relaxed text-colorTextTertiary">
                    {text}
                </div>
            </RevealCollapse>
        </div>
    )
}
