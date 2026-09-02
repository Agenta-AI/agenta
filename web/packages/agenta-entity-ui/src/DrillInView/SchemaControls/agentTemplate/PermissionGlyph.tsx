/**
 * The permission glyphs, used everywhere a connection policy is summarized: the integration row,
 * the drawer's default-permission select, a group rollup, and a per-tool select.
 *
 * bell = always asks · pencil = allows reads, asks to write · circled check = allow all ·
 * circle with a slash = denied · sliders = custom.
 *
 * One map over both vocabularies, so a preset and the per-tool value it corresponds to can never
 * be drawn with different glyphs.
 */
import {
    Bell,
    CheckCircle,
    PencilSimpleLine,
    Prohibit,
    SlidersHorizontal,
} from "@phosphor-icons/react"

import type {IntegrationPreset} from "../integrationPolicy"
import type {GatewayPermission} from "../toolUtils"

const GLYPHS = {
    always_ask: Bell,
    ask: Bell,
    ask_writes: PencilSimpleLine,
    // `inherit` shares the pencil: both mean the tool follows the agent's policy, not a rule of
    // its own.
    inherit: PencilSimpleLine,
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
    value: IntegrationPreset | GatewayPermission
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
