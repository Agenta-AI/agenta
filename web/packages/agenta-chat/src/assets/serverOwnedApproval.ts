import {recordAnswerThenRelease} from "@agenta/playground/agent-chat"

/**
 * Keep the server as the sole continuation owner even when its HTTP response is ambiguous.
 * A rejected request may have committed before the connection failed, so the browser must retire
 * its local auto-resume marker on both success and failure while still propagating the error.
 */
export async function submitServerOwnedApproval<T>({
    submit,
    retire,
}: {
    submit: () => Promise<T>
    retire: () => void
}): Promise<T> {
    try {
        return await submit()
    } finally {
        retire()
    }
}

export interface ApprovalSubmissionOutcome {
    durable: boolean
    recoverable: boolean
}

/** Choose the approval owner from the server capability, preserving the original local path. */
export async function submitApprovalForCapability({
    durableApprovals,
    submitDurable,
    retireDurable,
    recordLegacy,
    releaseLegacy,
}: {
    durableApprovals: boolean
    submitDurable: () => Promise<ApprovalSubmissionOutcome>
    retireDurable: () => void
    recordLegacy: () => Promise<void>
    releaseLegacy: () => void
}): Promise<ApprovalSubmissionOutcome> {
    if (durableApprovals) {
        return submitServerOwnedApproval({submit: submitDurable, retire: retireDurable})
    }
    await recordAnswerThenRelease({record: recordLegacy, release: releaseLegacy})
    return {durable: false, recoverable: false}
}
