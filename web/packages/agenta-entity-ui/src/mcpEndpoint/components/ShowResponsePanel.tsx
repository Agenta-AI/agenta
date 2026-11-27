/**
 * The raw answer behind a failed check, for the person who has to fix the server.
 *
 * Collapsed by default because it is debugging material, not an explanation: the sentence
 * above it already says what went wrong. The body is cut to the data layer's own limit,
 * because what is on the other end of the address is whatever answered, and a megabyte of
 * HTML in a dialog helps nobody. The reader cuts it too; this is the same constant, so the
 * panel cannot be the place a longer body gets through.
 *
 * It renders only when the probe carried the server's answer, which it does whenever
 * something answered (`problem.response` in `api/oss/src/core/gateways/mcps/probe.py`).
 */
import {useState} from "react"

import {PROBE_RESPONSE_BODY_LIMIT} from "@agenta/entities/mcpEndpoint"
import {useT} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {CopyButton} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"

export interface ShowResponsePanelProps {
    /** The status line, when the answer had one. */
    statusLine?: string | null
    body: string
}

export const ShowResponsePanel = ({statusLine, body}: ShowResponsePanelProps) => {
    const t = useT(mcpConnectCatalog)
    const [open, setOpen] = useState(false)
    const text = [statusLine, body.slice(0, PROBE_RESPONSE_BODY_LIMIT)].filter(Boolean).join("\n")

    return (
        <div className="min-w-0">
            <Button
                variant="link"
                size="xs"
                className="px-0 align-baseline text-meta"
                aria-expanded={open}
                onClick={() => setOpen((current) => !current)}
            >
                {open
                    ? t("entityUi.mcpConnect.hideResponse")
                    : t("entityUi.mcpConnect.showResponse")}
            </Button>
            {open ? (
                <div className="mt-2 min-w-0 overflow-hidden rounded-control-sm border border-solid border-border">
                    <div className="flex items-center justify-between border-0 border-b border-solid border-border bg-muted py-1 pl-2 pr-1 text-meta text-muted-foreground">
                        {t("entityUi.mcpConnect.serverResponse")}
                        <CopyButton text={text} icon variant="ghost" size="xs" />
                    </div>
                    <pre
                        data-testid="mcp-probe-response"
                        className="m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all bg-background p-2 font-mono text-code leading-normal text-foreground"
                    >
                        {text}
                    </pre>
                </div>
            ) : null}
        </div>
    )
}

export default ShowResponsePanel
