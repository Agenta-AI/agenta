import {openProviderDrawerRequestAtom} from "@agenta/shared/state"
import {Button} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"
import {Lock} from "lucide-react"

/**
 * In-thread callout for a first turn that is parked on the connect-model gate: the message was
 * accepted and is waiting, but nothing ran and nothing will until the project has a provider key.
 * It stands in for the assistant's loading bubble (see TranscriptPlaceholder), so the transcript
 * states the reason instead of spinning forever (#6441). Deliberately NOT the failed-run callout —
 * no run failed here, because no run started.
 *
 * The button reuses the failed-run escape hatch: it writes `openProviderDrawerRequestAtom`, which
 * `ConnectModelBanner` (always mounted in the composer dock) answers by opening the providers
 * drawer. Saving a key there clears the gate and the parked seed sends itself.
 */
const ConnectModelCallout = () => {
    const requestProviderDrawer = useSetAtom(openProviderDrawerRequestAtom)

    return (
        <div className="flex items-start gap-2 rounded-xl bg-[var(--ag-colorWarningBg)] px-4 py-3">
            <Lock size={16} className="mt-px shrink-0 text-[var(--ag-colorWarningText)]" />
            <div className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="text-xs font-medium text-[var(--ag-colorWarningText)]">
                    This agent needs a model provider key
                </span>
                <span className="text-xs text-[var(--ag-colorWarningText)]">
                    Your message is waiting — it sends as soon as a key is connected.
                </span>
                <Button
                    size="sm"
                    variant="outline"
                    className="mt-1"
                    onClick={() => requestProviderDrawer(true)}
                >
                    Set up model providers
                </Button>
            </div>
        </div>
    )
}

export default ConnectModelCallout
