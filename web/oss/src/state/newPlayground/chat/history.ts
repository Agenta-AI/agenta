import {getAllMetadata} from "@agenta/entities/legacyAppRevision"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {extractValueByMetadata} from "@/oss/lib/shared/variant/valueHelpers"
import {chatSessionsByIdAtom, chatTurnsByIdAtom} from "@/oss/state/generation/entities"

/**
 * Build full chat history for a revision by folding session turns in order.
 * Returns simplified message objects (role/content) extracted via metadata.
 */
export const historyByRevisionAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const sessions = get(chatSessionsByIdAtom) as Record<string, any>
        const turns = get(chatTurnsByIdAtom) as Record<string, any>
        const allMeta = getAllMetadata()
        const sid = `session-${revisionId}`
        const ids: string[] = (sessions?.[sid]?.turnIds || []).filter(Boolean)
        const messages: {role: string; content: any}[] = []
        for (const id of ids) {
            const t = turns?.[id]
            if (!t) continue
            const user = t?.userMessage
            if (user) {
                try {
                    const u = extractValueByMetadata(user, allMeta) as any
                    if (u?.role && u?.content !== undefined)
                        messages.push({role: u.role, content: u.content})
                } catch {
                    const content = user?.content?.value ?? user?.content ?? ""
                    const role = user?.role?.value ?? user?.role ?? "user"
                    messages.push({role, content})
                }
            }
            const a = t?.assistantMessageByRevision?.[revisionId]
            if (a) {
                try {
                    const ar = extractValueByMetadata(a, allMeta) as any
                    if (ar?.role && ar?.content !== undefined)
                        messages.push({role: ar.role, content: ar.content})
                } catch {
                    const content = a?.content?.value ?? a?.content ?? ""
                    const role = a?.role?.value ?? a?.role ?? "assistant"
                    messages.push({role, content})
                }
            }

            const toolResponses = t?.toolResponsesByRevision?.[revisionId]
            if (Array.isArray(toolResponses)) {
                for (const toolNode of toolResponses) {
                    try {
                        const toolVal = extractValueByMetadata(toolNode, allMeta) as any
                        messages.push(toolVal as any)
                    } catch {
                        const content = toolNode?.content?.value ?? toolNode?.content ?? ""
                        const role = toolNode?.role?.value ?? toolNode?.role ?? "tool"
                        messages.push({role, content})
                    }
                }
            }
        }
        return messages
    }),
)
