import {useState} from "react"

import {RevealCollapse} from "@agenta/chat/components"
import type {AgentModelKeyStatus} from "@agenta/chat/hooks"
import {Lock} from "lucide-react"

import {Button} from "@/components/ui/button"

import {ProviderKeySheet} from "../settings/ProviderKeySheet"

/**
 * Mobile skin of the desktop `ConnectModelBanner` — the set-up-your-key prompt above the composer
 * while the project vault holds no provider connection (`gateActive` on `useAgentModelKeyStatus`,
 * which is project-wide, not per-provider). The composer is disabled alongside it, and the task
 * parked by Home waits instead of being spent on a run that would fail (see `pendingTaskPolicy`).
 *
 * Before this, /m had no gate at all: a first message on a keyless project went out, the runner
 * answered 422 "no usable credential", and the user got a red "The agent run failed" bubble with a
 * raw backend reason and nothing to click. The vault lived only in Settings, which a new user has
 * no reason to open.
 *
 * The button opens THIS app's provider-key sheet — the same one Settings → LLM providers opens —
 * scoped to the agent's own provider (`providerEntry`). Desktop instead opens a drawer listing
 * every provider, and then repoints the agent's model at whatever was connected. Asking for the
 * one key the agent already needs reaches the same end state in one field, with no config write.
 *
 * Always mounted so it can animate IN (gate activates) and OUT (key saved) through `RevealCollapse`
 * — the shared composer-chrome idiom this app already uses for the mic notice — instead of
 * popping. The sheet sits outside the collapse: it must survive the strip closing under it, which
 * is exactly what happens when the key lands.
 */
export const ConnectModelStrip = ({
    providerEntry,
    gateActive,
}: Pick<AgentModelKeyStatus, "providerEntry" | "gateActive">) => {
    const [open, setOpen] = useState(false)

    return (
        <>
            <RevealCollapse open={gateActive}>
                <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-solid border-colorWarning/30 bg-colorWarningBg px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-xs text-colorWarningText">
                        <Lock className="size-3.5 shrink-0" />
                        <span className="truncate">
                            Add your model provider key to run this agent.
                        </span>
                    </span>
                    <Button size="sm" className="shrink-0" onClick={() => setOpen(true)}>
                        Add key
                    </Button>
                </div>
            </RevealCollapse>
            <ProviderKeySheet open={open} provider={providerEntry} onClose={() => setOpen(false)} />
        </>
    )
}
