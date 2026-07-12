/**
 * LensRail — the three-tab lens selector (build-spec §2), shared by the docked Inspector and the
 * compare-column drawer. Always three tabs; the Raw `{}` toggle lives in the header, not here.
 */
import {Button} from "antd"

import type {InspectorLens} from "./state"

const LABEL: Record<InspectorLens, string> = {
    timeline: "Timeline",
    context: "Context",
    runtime: "Runtime",
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
                <Button
                    key={l}
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
            ))}
        </div>
    )
}

/** The three lens bodies, prop-driven — reused by both hosts. */
export {TimelineLens} from "./lenses/TimelineLens"
export {ContextLens} from "./lenses/ContextLens"
export {RuntimeLens} from "./lenses/RuntimeLens"
