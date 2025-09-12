import {useMemo} from "react"

import {atom, useAtomValue} from "jotai"

import {chatHistorySelectorFamily} from "@/oss/components/Playground/state/selectors/history"
import {chatTurnsByIdAtom} from "@/oss/state/generation/entities"

export const useUserMessageValue = (resolvedTurnId: string) => {
    const userContentAtom = useMemo(
        () =>
            atom((get) => {
                const turn = get(chatTurnsByIdAtom)[resolvedTurnId]
                const val = turn?.userMessage?.content?.value
                return typeof val === "string" ? val : ""
            }),
        [resolvedTurnId],
    )
    const directUserContent = useAtomValue(userContentAtom) as string
    return directUserContent
}

export const useHistoryUserContent = (effectiveRevisionId: string, untilTurnId: string) => {
    const history = useAtomValue(
        useMemo(
            () => chatHistorySelectorFamily({revisionId: effectiveRevisionId, untilTurnId}),
            [effectiveRevisionId, untilTurnId],
        ),
    ) as any[]

    const text = useMemo(() => {
        const extractText = (c: any): string => {
            if (typeof c === "string") return c
            if (Array.isArray(c)) {
                try {
                    const parts = c
                        .map((p: any) =>
                            p?.type === "text" ? (p?.text?.value ?? p?.text ?? "") : undefined,
                        )
                        .filter(Boolean) as string[]
                    return parts.join("\n\n").trim()
                } catch {
                    return ""
                }
            }
            return ""
        }
        try {
            const lastUser = [...(history || [])]
                .reverse()
                .find((m: any) => m?.role === "user" && extractText(m?.content).length > 0)
            const c = lastUser?.content
            const out = extractText(c)
            return out || ""
        } catch {
            return ""
        }
    }, [history])

    return text
}

export const useResolvedUserContent = (direct: string, historyText: string) => {
    return useMemo(() => {
        const v = typeof direct === "string" ? direct : ""
        if (v.trim().length > 0) return v
        return historyText || ""
    }, [direct, historyText])
}

export default useResolvedUserContent
