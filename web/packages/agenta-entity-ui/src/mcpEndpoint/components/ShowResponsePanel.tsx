/**
 * The raw answer behind a failed check, for the person who has to fix the server.
 *
 * Collapsed by default because it is debugging material, not an explanation: the sentence
 * above it already says what went wrong. The body is cut to the data layer's own limit,
 * because what is on the other end of the address is whatever answered, and a megabyte of
 * HTML in a dialog helps nobody. The reader cuts it too; this is the same constant, so the
 * panel cannot be the place a longer body gets through.
 *
 * It renders only when there IS a body. The probe does not return one today
 * (`api/oss/src/core/gateways/mcps/probe.py` keeps the status and the sentence and drops the
 * payload), so nothing in the product reaches this yet; it is here because the panel is the
 * spec's, and the day the probe carries a body the panel is already the right shape.
 */
import {useState} from "react"

import {PROBE_RESPONSE_BODY_LIMIT} from "@agenta/entities/mcpEndpoint"
import {Button} from "@agenta/ui/ui"

export interface ShowResponsePanelProps {
    /** The status line, when the answer had one. */
    statusLine?: string | null
    body: string
}

export const ShowResponsePanel = ({statusLine, body}: ShowResponsePanelProps) => {
    const [open, setOpen] = useState(false)

    return (
        <>
            <Button
                variant="link"
                size="xs"
                className="px-0 align-baseline text-xs"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
            >
                {open ? "Hide response" : "Show response"}
            </Button>
            {open ? (
                <pre
                    data-testid="mcp-probe-response"
                    className="m-0 mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-control-sm bg-colorFillTertiary p-2 font-mono text-[11px] leading-normal text-colorTextSecondary"
                >
                    {[statusLine, body.slice(0, PROBE_RESPONSE_BODY_LIMIT)]
                        .filter(Boolean)
                        .join("\n")}
                </pre>
            ) : null}
        </>
    )
}

export default ShowResponsePanel
