import {ProviderDrawer} from "@agenta/entity-ui/secretProvider"
import {Button} from "antd"
import {Lock} from "lucide-react"

import type {AgentModelKeyStatus} from "../hooks/useAgentModelKeyStatus"
import {useOnboardingProviderSetup} from "../hooks/useOnboardingProviderSetup"

import RevealCollapse from "./RevealCollapse"

/**
 * Set-up-your-key prompt shown above the composer while the project vault is empty (see `gateActive`
 * on `useAgentModelKeyStatus` — project-wide, not per-provider). The composer is disabled alongside it
 * (the parent gates on the same status).
 *
 * The button opens the providers drawer DIRECTLY — the same drawer the Model section's dashed pill
 * opens. It used to flip the playground to Build and open the Model section instead, which only
 * showed that pill: a second "set up your providers" prompt standing between the user and the form
 * that actually takes a key. Connecting from here also points the agent at what was just connected
 * (see `useOnboardingProviderSetup`), so the gate clears and the composer is ready to type in.
 *
 * Always mounted so it can animate IN (gate activates) and OUT (key added / not applicable) via
 * `RevealCollapse` instead of popping. Shown only when `gateActive` and not `suppressed` (the
 * pre-commit onboarding defers the check).
 */
const ConnectModelBanner = ({
    entityId,
    gateActive,
    suppressed = false,
}: AgentModelKeyStatus & {entityId: string; suppressed?: boolean}) => {
    const setup = useOnboardingProviderSetup(entityId, {gateActive})

    const open = !suppressed && gateActive

    return (
        <>
            <RevealCollapse open={open}>
                <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-xs text-[var(--ag-colorWarningText)]">
                        <Lock size={14} className="shrink-0" />
                        <span className="truncate">
                            Add your model provider key to run this agent.
                        </span>
                    </span>
                    <Button type="primary" onClick={setup.openDrawer} className="shrink-0">
                        Set up model providers
                    </Button>
                </div>
            </RevealCollapse>
            {/* Outside the collapse: the drawer must survive the banner closing under it, which is
                exactly what happens when the key lands and the gate clears. */}
            <ProviderDrawer
                open={setup.open}
                onClose={setup.closeDrawer}
                context="playground"
                connections={setup.connections}
                onSaved={setup.onSaved}
            />
        </>
    )
}

export default ConnectModelBanner
