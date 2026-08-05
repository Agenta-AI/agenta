import {useCallback, useMemo} from "react"

import {Tag} from "@phosphor-icons/react"
import type {MenuProps} from "antd"
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
    menuItems: MenuProps["items"]
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

    const menuItems = useMemo<MenuProps["items"]>(() => {
        if (!config?.storageKey && !config?.onEnabledChange) return undefined

        return [
            {
                key: "type-chips-toggle",
                label: enabled ? "Hide type chips" : "Show type chips",
                icon: <Tag size={16} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    setEnabled(!enabled)
                },
            },
        ]
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
