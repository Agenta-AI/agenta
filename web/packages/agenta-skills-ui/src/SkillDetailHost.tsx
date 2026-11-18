import {projectIdAtom} from "@agenta/shared/state"
import {skillsResolveDataAtom} from "@agenta/skills/state"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button} from "@agenta/ui/ui"
import {X} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {SkillDetailView} from "./SkillDetailView"

/** The playground's skill detail: the skill page's view in a drawer, found by embed slug. */
export function SkillDetailHost({
    open,
    onClose,
    slug,
}: {
    open: boolean
    onClose: () => void
    slug: string | null
}) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const registry = useAtomValue(skillsResolveDataAtom)
    const match = slug
        ? registry.find((skill) => skill.workflow_slug === slug || skill.skill_name === slug)
        : undefined
    const workflowId = match?.workflow_id ?? ""

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open && Boolean(workflowId)}
            onClose={onClose}
            placement="right"
            width={960}
            closable={false}
            destroyOnClose
            styles={{body: {padding: 20}}}
        >
            {workflowId ? (
                <SkillDetailView
                    projectId={projectId}
                    workflowId={workflowId}
                    onArchived={onClose}
                    top={
                        <div className="flex justify-end">
                            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
                                <X size={16} />
                            </Button>
                        </div>
                    }
                />
            ) : null}
        </EnhancedDrawer>
    )
}
