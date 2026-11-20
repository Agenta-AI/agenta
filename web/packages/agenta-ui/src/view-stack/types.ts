import type {ComponentType, ReactNode} from "react"

/** The address of one configuration item. Same shape as the target segment of a builder operation. */
export interface ConfigItemRef {
    list: "tools" | "mcps" | "skills" | "files"
    key: string
}

/** Where a view writes. Explicit, never inferred from an optional id. */
export type ViewTarget =
    /** Writes the agent draft; auto-save then saves it as a new version. */
    | {kind: "agent_draft"; revisionId: string}
    /** Writes a project resource on the server. */
    | {kind: "project"}

/**
 * "on_save": the chrome shows Cancel and Save; edits reach the target only on Save.
 * "immediate": edits reach the target at once; the chrome shows Done.
 */
export type ViewApply = "on_save" | "immediate"

/** A view definition. A module exports it; nothing registers it globally. */
export interface ViewDef<P> {
    /** Stable id that names the view in tests and logs. Never stored. Example: "agent.skill". */
    id: string
    apply: ViewApply
    /** The panel chrome offers "Widen the panel" for this view. Other containers ignore it. */
    wide?: boolean
    /** The body. Use a `next/dynamic` component so the code loads on first open. */
    Component: ComponentType<ViewProps<P>>
}

/** Params carry addresses only, never display names. */
export interface ViewProps<P> {
    params: P
    target: ViewTarget
    nav: ViewNav
}

/** What a view can ask of its stack. */
export interface ViewNav {
    depth: 1 | 2
    /**
     * Open a child view with its own target (most children pass the parent's target). Null at
     * depth 2: two levels at most. A child with its own form (`apply: "on_save"`) opens only after
     * the person saved or discarded the parent's edits; an "immediate" child is a picker and
     * opens over the dirty parent.
     */
    push: (<C>(view: ViewDef<C>, params: C, target: ViewTarget) => Promise<boolean>) | null
    /** Guarded back: asks first when this view's form is dirty. */
    back: () => Promise<boolean>
    /** Cancel: discards the local form without asking, then goes back. */
    cancel: () => void
}

/** What an "on_save" view reports. An "immediate" view reports nothing. */
export interface ViewForm {
    dirty: boolean
    valid: boolean
    /**
     * Write the edits. Resolve true on success. From Save the stack then goes back; before a
     * child form opens, the view mounts again from the saved data.
     */
    save: () => Promise<boolean>
    /** Text of the unsaved-changes dialog for this view (it names what Save writes). */
    leaveDescription: string
}

/** For the container's root and for the container itself. */
export interface ViewStack {
    /** Replace the stack with one view at depth 1. Resolves false when the person kept editing. */
    open: <P>(view: ViewDef<P>, params: P, target: ViewTarget) => Promise<boolean>
    /** Leave every view. Resolves false when the person chose "Keep editing". */
    closeAll: () => Promise<boolean>
    /** True while any view has a dirty form or a save in flight. A picker on top does not hide a dirty parent. */
    dirty: boolean
    /** Number of open views, 0 at the root. */
    depth: 0 | 1 | 2
}

/** The top view's form as the chrome draws it. */
export type ViewChromeForm = ViewForm & {
    saving: boolean
    /** The last Save of this view failed; the view stays open with its edits. */
    saveFailed: boolean
}

/** What a container draws around the open views. */
export interface ViewChromeProps {
    /** The root crumb first (when the container names its root), then one crumb per view. */
    crumbs: {title: string; onSelect?: () => void}[]
    apply: ViewApply
    wide: boolean
    form: ViewChromeForm | null
    /** Guarded back one level. */
    onBack: () => void
    /** Discard the top view's form and go back one level, without a question. */
    onCancel: () => void
    /** Save the top view's form: ignored while a save runs; goes back one level on success. */
    onSave: () => void
    children: ReactNode
}
