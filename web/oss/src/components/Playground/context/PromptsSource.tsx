import React, {createContext, useContext, useMemo} from "react"

import {useAtomValue} from "jotai"

import {moleculeBackedPromptsAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

type PromptsMap = Record<string, any[] | undefined>
interface CtxValue {
    promptsByRevision?: PromptsMap
    preferProvided?: boolean
}

const PromptsSourceContext = createContext<CtxValue | null>(null)

export const PromptsSourceProvider = ({
    children,
    promptsByRevision,
    preferProvided = false,
}: React.PropsWithChildren<{promptsByRevision?: PromptsMap; preferProvided?: boolean}>) => {
    const value = useMemo(
        () => ({promptsByRevision, preferProvided}),
        [promptsByRevision, preferProvided],
    )
    return <PromptsSourceContext.Provider value={value}>{children}</PromptsSourceContext.Provider>
}

/**
 * Hook: unified prompts source
 * - If a provider supplies prompts for the given revision, use them
 * - Otherwise fall back to the live editable promptsAtomFamily(revisionId)
 */
export function usePromptsSource(revisionId: string): any[] {
    const ctx = useContext(PromptsSourceContext)
    const provided = ctx?.promptsByRevision?.[revisionId]
    // Use molecule-backed prompts for single source of truth
    const prompts = useAtomValue(moleculeBackedPromptsAtomFamily(revisionId)) as any[]
    return (provided as any[]) ?? prompts ?? []
}

export function usePromptsSourcePreference(): boolean {
    const ctx = useContext(PromptsSourceContext)
    return Boolean(ctx?.preferProvided)
}
