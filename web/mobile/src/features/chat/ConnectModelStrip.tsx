import {useState} from "react"

import {RevealCollapse} from "@agenta/chat/components"
import {modelComposerChrome, type AgentModelKeyStatus} from "@agenta/chat/hooks"
import {Lock} from "lucide-react"

import {Button} from "@/components/ui/button"

import {ProviderKeySheet} from "../settings/ProviderKeySheet"

/**
 * Mobile skin of the desktop `ConnectModelBanner` — missing-key (`gateActive`) or down-runner
 * (`runnerUnavailable`) prompt above the composer. The composer is disabled alongside it, and the
 * task parked by Home waits instead of being spent on a run that would fail (see `pendingTaskPolicy`).
 *
 * The missing-key button opens THIS app's provider-key sheet. A down runner has no key CTA.
 *
 * Always mounted so it can animate IN and OUT through `RevealCollapse`. The sheet sits outside the
 * collapse: it must survive the strip closing under it when the key lands.
 */
export const ConnectModelStrip = ({
    providerEntry,
    gateActive,
    runnerUnavailable,
}: Pick<AgentModelKeyStatus, "providerEntry" | "gateActive" | "runnerUnavailable">) => {
    const [open, setOpen] = useState(false)
    const chrome = modelComposerChrome({gateActive, runnerUnavailable})

    return (
        <>
            <RevealCollapse open={chrome.locked}>
                <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-solid border-colorWarning/30 bg-colorWarningBg px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-xs text-colorWarningText">
                        <Lock className="size-3.5 shrink-0" />
                        <span className="truncate">{chrome.bannerMessage}</span>
                    </span>
                    {chrome.showProviderSetup ? (
                        <Button size="sm" className="shrink-0" onClick={() => setOpen(true)}>
                            Add key
                        </Button>
                    ) : null}
                </div>
            </RevealCollapse>
            <ProviderKeySheet open={open} provider={providerEntry} onClose={() => setOpen(false)} />
        </>
    )
}
