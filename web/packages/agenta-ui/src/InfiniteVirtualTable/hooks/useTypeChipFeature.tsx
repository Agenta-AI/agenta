import {type ReactNode, useCallback, useMemo} from "react"

import {DropdownMenuItem} from "@agenta/primitive-ui/components/dropdown-menu"
import {Tag} from "@phosphor-icons/react"
import {atom, useAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import type {TypeChipConfig} from "../types"

type TypeChipEnabledAtom = ReturnType<typeof atomWithStorage<boolean>>

const atomCache = new Map<string, TypeChipEnabledAtom>()

function getOrCreateAtom(storageKey: string, defaultEnabled: boolean): TypeChipEnabledAtom {
    const existing = atomCache.get(storageKey)
    if (existing) return existing

    const newAtom = atomWithStorage<boolean>(storageKey, defaultEnabled)
    atomCache.set(storageKey, newAtom)
    return newAtom
}

export interface UseTypeChipFeatureResult<RecordType> {
    enabled: boolean
    setEnabled: (enabled: boolean) => void
    menuItems: ReactNode
    typeChips: TypeChipConfig<RecordType> | undefined
}

export function useTypeChipFeature<RecordType>(
    config: TypeChipConfig<RecordType> | undefined,
): UseTypeChipFeatureResult<RecordType> {
    const defaultEnabled = config?.defaultEnabled ?? config?.enabled ?? Boolean(config)

    const enabledAtom = useMemo(() => {
        if (config?.storageKey) return getOrCreateAtom(config.storageKey, defaultEnabled)
        return atom(defaultEnabled)
    }, [config?.storageKey, defaultEnabled])

    const [storedEnabled, setStoredEnabled] = useAtom(enabledAtom)
    const enabled = config?.enabled ?? storedEnabled

    const setEnabled = useCallback(
        (next: boolean) => {
            if (config?.enabled === undefined) {
                setStoredEnabled(next)
            }
            config?.onEnabledChange?.(next)
        },
        [config, setStoredEnabled],
    )

    const menuItems = useMemo<ReactNode>(() => {
        if (!config?.storageKey && !config?.onEnabledChange) return undefined

        return (
            <DropdownMenuItem
                key="type-chips-toggle"
                onClick={(e) => {
                    e.stopPropagation()
                    setEnabled(!enabled)
                }}
            >
                <Tag size={16} />
                {enabled ? "Hide type chips" : "Show type chips"}
            </DropdownMenuItem>
        )
    }, [config?.onEnabledChange, config?.storageKey, enabled, setEnabled])

    const resolvedTypeChips = useMemo<TypeChipConfig<RecordType> | undefined>(() => {
        if (!config) return undefined

        const {defaultEnabled: _defaultEnabled, storageKey: _storageKey, ...rest} = config
        return {
            ...rest,
            enabled,
        }
    }, [config, enabled])

    return {
        enabled,
        setEnabled,
        menuItems,
        typeChips: resolvedTypeChips,
    }
}
