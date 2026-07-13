/**
 * LensRail — the three-tab lens selector (build-spec §2), shared by the docked Inspector and the
 * compare-column drawer. Always three tabs; the Raw `{}` toggle lives in the header, not here.
 */
import {Button, Tooltip} from "antd"

import type {InspectorLens} from "./state"

const LABEL: Record<InspectorLens, string> = {
    timeline: "Timeline",
    context: "Context",
    runtime: "Runtime",
}

// One-line "what is this and when do I use it" for each lens — surfaced as a tab tooltip so the
// distinction is learnable in place (Timeline = what the agent DID; Context = what the model SAW).
const DESC: Record<InspectorLens, string> = {
    timeline:
        "What the agent did — every event in order (messages, tool calls & results, errors) with timing. For tracing behaviour.",
    context:
        "What the model saw — the role-tagged messages fed to the model, with an approximate token count. For auditing the context window.",
    runtime:
        "Live sandbox for this session — streams, session state, and mounts. Session-level, not per turn.",
}

export function LensRail({
    lens,
    onChange,
}: {
    lens: InspectorLens
    onChange: (lens: InspectorLens) => void
}) {
    return (
        <div className="flex shrink-0 items-center gap-1 border-0 border-b border-solid border-[#2a2c30] px-2 py-1.5">
            {(["timeline", "context", "runtime"] as InspectorLens[]).map((l) => (
                <Tooltip key={l} title={DESC[l]} placement="bottom" mouseEnterDelay={0.4}>
                    <Button
                        type="text"
                        size="small"
                        onClick={() => onChange(l)}
                        className={`!h-7 !rounded-md !px-2.5 !text-xs ${
                            lens === l
                                ? "!bg-[var(--ag-colorPrimaryBg)] !font-medium !text-[var(--ag-colorPrimary)]"
                                : "!text-[var(--ag-colorTextSecondary)] hover:!bg-[#212327]"
                        }`}
                    >
                        {LABEL[l]}
                    </Button>
                </Tooltip>
            ))}
        </div>
    )
}

/** The three lens bodies, prop-driven — reused by both hosts. */
export {TimelineLens} from "./lenses/TimelineLens"
export {ContextLens} from "./lenses/ContextLens"
export {RuntimeLens} from "./lenses/RuntimeLens"
