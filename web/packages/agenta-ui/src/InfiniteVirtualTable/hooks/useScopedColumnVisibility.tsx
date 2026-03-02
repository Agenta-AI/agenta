import {useMemo} from "react"

import type {ColumnsType} from "antd/es/table"

import {useColumnVisibility} from "../hooks/useColumnVisibility"

interface Options {
    scopeId: string | null
    storageKey?: string
    defaultHiddenKeys?: string[]
}

export const useScopedColumnVisibility = <Row extends object>(
    columns: ColumnsType<Row>,
    {scopeId, storageKey, defaultHiddenKeys = []}: Options,
) => {
    const scopedStorageKey = useMemo(() => {
        if (!storageKey) return undefined
        return scopeId ? `${storageKey}::${scopeId}` : storageKey
    }, [scopeId, storageKey])

    return useColumnVisibility(columns, {
        storageKey: scopedStorageKey,
        defaultHiddenKeys,
    })
}

export default useScopedColumnVisibility
