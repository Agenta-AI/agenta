import {useMemo} from "react"

import {atom, useAtomValue} from "jotai"

import {getAllMetadata, getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"

export const useMessageMetadata = (variantId?: string) => {
    const variantPrompts = useAtomValue(
        variantId ? promptsAtomFamily(variantId) : atom([]),
    ) as any[]

    const messageMetadata = useMemo(() => {
        try {
            const sample = (variantPrompts || [])
                .flatMap((p: any) => p?.messages?.value || [])
                .find(Boolean)
            if (sample?.__metadata) {
                return getMetadataLazy(sample.__metadata as string) as any
            }
            // Optional fallback: attempt a generic Message schema
            const all = getAllMetadata?.()
            if (all) {
                const found = Object.values(all).find(
                    (m: any) => m?.title === "Message" && m?.properties && m?.properties?.role,
                )
                if (found) return found as any
            }
            return undefined
        } catch {
            return undefined
        }
    }, [variantPrompts])

    return messageMetadata
}

export default useMessageMetadata
