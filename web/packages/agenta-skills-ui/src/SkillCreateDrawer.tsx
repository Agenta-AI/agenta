/**
 * The Skills page's "New skill" drawer: a thin drawer around the one new skill view (F07 f12 to
 * f15), opened on the way the page menu picked. Hosts keep their props.
 */
import {useMemo} from "react"

import type {SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {ViewDrawerHost, type ViewRequest} from "@agenta/ui/view-stack"

import type {NewSkillStart} from "./NewSkillBody"
import {registryNewSkillView, type RegistryNewSkillParams} from "./registryNewSkillView"

export interface SkillCreateDrawerProps {
    open: boolean
    onClose: () => void
    /** The project is read from the app state; kept so hosts do not change. */
    projectId?: string
    /** A picked upload, still being read: the view opens on its upload step with it. */
    upload?: Promise<SkillUploadScan> | null
    /** The step to open on when there is no upload; "write" by default. */
    start?: "choose" | "write" | "import"
    width?: number
}

export function SkillCreateDrawer({
    open,
    onClose,
    upload = null,
    start = "write",
    width,
}: SkillCreateDrawerProps) {
    const request = useMemo<ViewRequest<RegistryNewSkillParams>>(() => {
        const first: NewSkillStart = upload ? {step: "upload", scan: upload} : {step: start}
        return {view: registryNewSkillView, params: {start: first}, target: {kind: "project"}}
    }, [start, upload])
    if (!open) return null
    return <ViewDrawerHost request={request} onClosed={onClose} width={width} />
}
