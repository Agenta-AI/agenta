import React, {createContext, useContext, useMemo} from "react"

import {useAtomValue} from "jotai"

import {moleculeBackedPromptsAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

type PromptsMap = Record<string, any[] | undefined>

const PromptsSourceContext = createContext<CtxValue | null>(null)

export const PromptsSourceProvider = ({
    children,
    promptsByRevision,
}: React.PropsWithChildren<{promptsByRevision?: PromptsMap}>) => {
    const value = useMemo(() => ({promptsByRevision}), [promptsByRevision])
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
