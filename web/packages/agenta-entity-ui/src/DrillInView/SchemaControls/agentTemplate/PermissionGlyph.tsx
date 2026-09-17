/**
 * The permission glyphs, used everywhere a connection policy is summarized: the integration row,
 * the drawer's default-permission select, a group rollup, and a per-tool select.
 *
 * bell = always asks · pencil = allows reads, asks to write · circled check = allow all ·
 * circle with a slash = denied · sliders = custom · robot = the agent's own policy decides.
 *
 * One map over both vocabularies, so a preset and the per-tool value it corresponds to can never
 * be drawn with different glyphs.
 */
import {
    Bell,
    CheckCircle,
    PencilSimpleLine,
    Prohibit,
    Robot,
    SlidersHorizontal,
} from "@phosphor-icons/react"

import type {PermissionPresetValue} from "../integrationPolicy"
import type {GatewayPermission} from "../toolUtils"

const GLYPHS = {
    always_ask: Bell,
    ask: Bell,
    ask_writes: PencilSimpleLine,
    // The robot, not the pencil the "ask for write and delete" preset carries. The two shared it
    // while the preset's saved value WAS the absence of a policy; decision 45 gave the preset a
    // shape of its own, so "the agent decides" and "reads run, writes ask" are now two answers and
    // must not be one glyph. `inherit` and `follow_agent` are the same answer at two levels.
    inherit: Robot,
    follow_agent: Robot,
    allow_all: CheckCircle,
    allow: CheckCircle,
    deny_all: Prohibit,
    deny: Prohibit,
    custom: SlidersHorizontal,
} as const

/** A preset's or a single permission value's glyph. Custom is amber, matching its row label. */
export function PolicyGlyph({
    value,
    size = 13,
}: {
    value: PermissionPresetValue | GatewayPermission
    size?: number
}) {
    const Icon = GLYPHS[value]
    return (
        <Icon
            size={size}
            className={
                value === "custom"
                    ? "shrink-0 text-[var(--ag-colorWarningText)]"
                    : "shrink-0 text-[var(--ag-colorTextTertiary)]"
            }
        />
    )
}
