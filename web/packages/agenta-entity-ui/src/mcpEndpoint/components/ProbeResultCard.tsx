/**
 * What the check found, above the fields that act on it.
 *
 * The card exists so the address and the authorization the server asked for stay on screen
 * while the connection is named and credentialed. Both are what the person is deciding
 * about, and a flow that showed the address on one step and the key field on the next made
 * people close the dialog to check what they had typed.
 */
import {Button, cn, IconTile, touchTargetExpansion} from "@agenta/ui/ui"
import {CheckCircle, Plugs} from "@phosphor-icons/react"

/** How the server said it authorizes. `none` is a server that asked for nothing. */
export type ProbeResultMode = "oauth" | "api_key" | "none"

/**
 * The second line, one sentence per answer the probe can give.
 *
 * Kept here rather than at the three call sites so the three screens cannot drift into
 * three wordings for the same finding.
 */
const SUMMARY: Record<ProbeResultMode, string> = {
    oauth: "Reachable · signs in with OAuth",
    api_key: "Reachable · needs an API key",
    none: "Reachable · no sign-in needed",
}

export interface ProbeResultCardProps {
    url: string
    mode: ProbeResultMode
    /** Back to the address. Omitted where the address is not this journey's to change. */
    onChange?: () => void
}

export const ProbeResultCard = ({url, mode, onChange}: ProbeResultCardProps) => (
    <div
        data-testid="mcp-probe-result"
        className="flex items-center gap-3 rounded-control border border-solid border-colorBorderSecondary bg-colorBgContainer px-3 py-2.5"
    >
        <IconTile size={32} tone="info">
            <Plugs size={18} />
        </IconTile>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate font-mono text-[13px] text-colorText" title={url}>
                {url}
            </span>
            <span className="flex items-center gap-1 text-xs text-colorTextSecondary">
                {/* Inherits the line's colour, as the design draws it: the finding is what
                    the glyph marks, not a status of its own. */}
                <CheckCircle size={13} className="shrink-0" />
                {SUMMARY[mode]}
            </span>
        </div>
        {onChange ? (
            <Button
                variant="link"
                size="xs"
                // The control scale's 24px is under the 44px touch minimum, so the invisible
                // expansion carries the rest. The card's own row keeps its height.
                className={cn("shrink-0 px-0 text-xs", touchTargetExpansion(24))}
                onClick={onChange}
            >
                Change
            </Button>
        ) : null}
    </div>
)

export default ProbeResultCard
