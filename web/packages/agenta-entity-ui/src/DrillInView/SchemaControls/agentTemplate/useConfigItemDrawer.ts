/**
 * The shared draft-then-save state machine for the agent-template list sections (tools / MCP /
 * skills). Edits happen on a local `draft`; they only apply to the config on Save, so creating an
 * item never pollutes the config until confirmed and editing can be cancelled cleanly. Which config
 * array a kind writes to, and what counts as a valid draft, come from {@link ITEM_KINDS} — so all
 * three kinds run through one path instead of three copies.
 */
import {useCallback, useEffect, useMemo, useState} from "react"

import type {ConfigItemView} from "../ConfigItemDrawer"

import {cloneItem} from "./agentTemplateUtils"
import {ITEM_KINDS, type ItemKind, type ItemKindDef} from "./itemKinds"

export interface EditingState {
    kind: ItemKind
    mode: "create" | "edit"
    index: number
}

export function useConfigItemDrawer({
    config,
    onChange,
}: {
    config: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
}) {
    const [editing, setEditing] = useState<EditingState | null>(null)
    const [draft, setDraft] = useState<Record<string, unknown>>({})
    const [drawerView, setDrawerView] = useState<ConfigItemView>("form")
    // JSON-view parse validity from the open drawer's JsonObjectEditor; blocks Save while the raw
    // JSON is invalid. Reset when the open item changes — each editor is keyed/remounts and starts
    // valid.
    const [jsonInvalid, setJsonInvalid] = useState(false)
    useEffect(() => {
        setJsonInvalid(false)
    }, [editing])

    const openCreate = useCallback(
        (kind: ItemKind, seed: Record<string, unknown>, view: ConfigItemView) => {
            setDraft(seed)
            setDrawerView(view)
            setEditing({kind, mode: "create", index: -1})
        },
        [],
    )
    const openEdit = useCallback(
        (kind: ItemKind, index: number, item: unknown, view: ConfigItemView) => {
            setDraft(cloneItem(item))
            setDrawerView(view)
            setEditing({kind, mode: "edit", index})
        },
        [],
    )
    const closeEditor = useCallback(() => setEditing(null), [])

    const fieldArray = useCallback(
        (field: ItemKindDef["field"]): unknown[] =>
            Array.isArray(config[field]) ? (config[field] as unknown[]) : [],
        [config],
    )

    // Apply the drawer's draft to the config: append (create) or replace at index (edit).
    const commitDraft = useCallback(() => {
        if (!editing) return
        const {field} = ITEM_KINDS[editing.kind]
        const next = [...fieldArray(field)]
        if (editing.mode === "create") next.push(draft)
        else next[editing.index] = draft
        onChange({...config, [field]: next})
        setEditing(null)
    }, [editing, draft, config, onChange, fieldArray])

    /** Drop one item by index from its kind's array. */
    const removeItem = useCallback(
        (kind: ItemKind, index: number) => {
            const {field} = ITEM_KINDS[kind]
            onChange({...config, [field]: fieldArray(field).filter((_, i) => i !== index)})
        },
        [config, onChange, fieldArray],
    )

    // Block Save until the draft has the minimum it needs to be a valid item.
    const draftInvalid = useMemo(
        () => (editing ? ITEM_KINDS[editing.kind].draftInvalid(draft) : true),
        [editing, draft],
    )

    return {
        editing,
        draft,
        setDraft,
        drawerView,
        setDrawerView,
        jsonInvalid,
        setJsonInvalid,
        openCreate,
        openEdit,
        closeEditor,
        commitDraft,
        removeItem,
        draftInvalid,
    }
}
