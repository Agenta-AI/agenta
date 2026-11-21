/**
 * Plain-language copy for `start_session`. The call names its agent by the slug or id the model
 * passed, so the card asks the host to look the agent up (`agentRef`) and describes the call again
 * with the agent's name. The card never shows the slug or the id.
 */
import {createT} from "@agenta/i18n"
import approvalCardCatalog from "@agenta/i18n/catalogs/chat.approvalCard"
import {asRecord} from "@agenta/shared/utils"

import type {ApprovalPreview, ApprovalPreviewItem} from "../../skin/types"

import {oneLine} from "./approvalText"

const tNow = createT(approvalCardCatalog)

const stringField = (value: unknown, field: string): string | undefined => {
    const found = asRecord(value)?.[field]
    return typeof found === "string" && found.trim() ? found.trim() : undefined
}

export const describeStartSession = (
    input: unknown,
    _manifest?: unknown,
    _appName?: string,
    _changePreview?: unknown,
    agentName?: string,
): ApprovalPreview | null => {
    const agentRef = stringField(input, "agent")
    if (!agentRef) return null
    const items: ApprovalPreviewItem[] = []
    const name = stringField(input, "name")
    if (name) items.push({title: tNow("chat.approvalCard.startSessionName"), detail: oneLine(name)})
    const text = stringField(input, "text")
    if (text) {
        items.push({title: tNow("chat.approvalCard.startSessionMessage"), detail: oneLine(text)})
    }
    return {
        sentence: tNow("chat.approvalCard.startSession", {
            agent: agentName ?? tNow("chat.approvalCard.anAgent"),
        }),
        items,
        agentRef,
    }
}
