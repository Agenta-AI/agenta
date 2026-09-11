import {useEffect} from "react"

import {RevealCollapse} from "@agenta/chat/components"
import {modelComposerChrome, type AgentModelKeyStatus} from "@agenta/chat/hooks"
import {ProviderDrawer} from "@agenta/entity-ui/secretProvider"
import {openProviderDrawerRequestAtom} from "@agenta/shared/state"
import {Button} from "@agenta/ui/ui"
import {useAtom} from "jotai"
import {Lock} from "lucide-react"

import {useOnboardingProviderSetup} from "../hooks/useOnboardingProviderSetup"

/**
 * Prompt above the composer while the project cannot run: missing provider key (`gateActive`) or a
 * down agent runner (`runnerUnavailable`). The composer is disabled alongside it.
 *
 * The missing-key button opens the providers drawer DIRECTLY. Connecting from here also points the
 * agent at what was just connected (see `useOnboardingProviderSetup`). A down runner has no CTA:
 * there is no key to add, and the probe already refetches on its own.
 *
 * Always mounted so it can animate IN and OUT via `RevealCollapse` instead of popping. Shown when
 * either lock reason is active and not `suppressed` (pre-commit onboarding defers the check).
 */
const ConnectModelBanner = ({
    entityId,
    gateActive,
    runnerUnavailable,
    suppressed = false,
}: AgentModelKeyStatus & {entityId: string; suppressed?: boolean}) => {
    const setup = useOnboardingProviderSetup(entityId, {gateActive})
    const [drawerRequested, setDrawerRequested] = useAtom(openProviderDrawerRequestAtom)
    const chrome = modelComposerChrome({gateActive, runnerUnavailable})

    const open = !suppressed && chrome.locked

    // A remote trigger (the failed-run callout) asks for the drawer. This component owns it, so it
    // opens here — the banner above stays closed unless its own gate is active.
    const {openDrawer} = setup
    useEffect(() => {
        if (!drawerRequested) return
        setDrawerRequested(false)
        openDrawer()
    }, [drawerRequested, setDrawerRequested, openDrawer])

    return (
        <>
            <RevealCollapse open={open}>
                <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-xs text-[var(--ag-colorWarningText)]">
                        <Lock size={14} className="shrink-0" />
                        <span className="truncate">{chrome.bannerMessage}</span>
                    </span>
                    {chrome.showProviderSetup ? (
                        <Button onClick={setup.openDrawer} className="shrink-0">
                            Set up model providers
                        </Button>
                    ) : null}
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
