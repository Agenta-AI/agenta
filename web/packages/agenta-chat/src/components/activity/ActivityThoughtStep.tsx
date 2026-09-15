import {useState} from "react"

import {CaretDown} from "@phosphor-icons/react"

import {useTypewriter} from "../../hooks/useTypewriter"
import RevealCollapse from "../RevealCollapse"

import {ActivityNode, LIVE_TEXT_CLASS} from "./activityIcons"

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
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                // The `after` box is the ~44px touch target; the row's own chrome never grows.
                className="relative -ml-1.5 flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-3.5 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-left group/row after:absolute after:-inset-y-2 after:inset-x-0 after:content-['']"
            >
                <ActivityNode icon="brain" />
                <span
                    className={`min-w-0 max-w-[44ch] truncate text-sm text-colorTextSecondary transition-colors group-hover/row:text-colorText ${
                        live || streaming ? LIVE_TEXT_CLASS : ""
                    }`}
                >
                    {line}
                </span>
                <CaretDown
                    size={9}
                    weight="bold"
                    className={`shrink-0 text-colorTextDisabled opacity-50 transition-transform ${
                        open ? "rotate-180" : ""
                    }`}
                />
            </button>
            <RevealCollapse open={open}>
                <div className="whitespace-pre-wrap break-words pl-[38px] text-[13px] italic leading-relaxed text-colorTextTertiary">
                    {text}
                </div>
            </RevealCollapse>
        </div>
    )
}
