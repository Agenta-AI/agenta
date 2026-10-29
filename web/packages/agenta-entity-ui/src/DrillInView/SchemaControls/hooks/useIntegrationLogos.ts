import {useMemo} from "react"

import {toolIntegrationDetailQueryFamily} from "@agenta/entities/gatewayTool"

import {useFamilyMap} from "./useFamilyMap"

export interface IntegrationMark {
    key: string
    name: string
    logo: string | null
}

const logoFamily = (key: string) => toolIntegrationDetailQueryFamily(key)

/** Resolve a set of integration keys to their brand name and logo, in one subscription. */
export function useIntegrationLogos(keys: string[]): Map<string, IntegrationMark> {
    const keysKey = useMemo(() => [...new Set(keys)].filter(Boolean).sort().join("\n"), [keys])
    const byKey = useFamilyMap(keysKey, logoFamily)
    return useMemo(() => {
        const marks = new Map<string, IntegrationMark>()
        for (const [key, res] of byKey) {
            const catalog = res?.data?.integration
            marks.set(key, {key, name: catalog?.name ?? key, logo: catalog?.logo ?? null})
        }
        return marks
    }, [byKey])
}
