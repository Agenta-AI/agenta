import {useState} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {skillsResolveDataAtom, skillsResolveQueryAtom} from "@agenta/skills/state"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button, Spinner} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {SkillDetailView} from "./SkillDetailView"
import {SkillDiscardDialog} from "./SkillDiscardDialog"

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
    const query = useAtomValue(skillsResolveQueryAtom)
    const registry = useAtomValue(skillsResolveDataAtom)
    const [dirty, setDirty] = useState(false)
    const [asking, setAsking] = useState(false)
    const match = slug
        ? (registry.find((skill) => skill.workflow_slug === slug) ??
          registry.find((skill) => skill.skill_name === slug))
        : undefined
    const workflowId = match?.workflow_id ?? ""

    const requestClose = () => (dirty ? setAsking(true) : onClose())
    const close = () => {
        setAsking(false)
        setDirty(false)
        onClose()
    }

    return (
        <>
            <EnhancedDrawer
                rootClassName="ag-drawer-elevated"
                open={open}
                onClose={requestClose}
                placement="right"
                width={960}
                closable={false}
                destroyOnClose
                styles={{body: {padding: 20, display: "flex", flexDirection: "column"}}}
            >
                {workflowId ? (
                    <SkillDetailView
                        key={workflowId}
                        projectId={projectId}
                        workflowId={workflowId}
                        onArchived={close}
                        onDirtyChange={setDirty}
                        onClose={requestClose}
                    />
                ) : (
                    <div className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground">
                        {query.isPending ? (
                            <Spinner size="small" />
                        ) : (
                            <>
                                This skill is not in the registry.
                                <Button variant="outline" size="sm" onClick={onClose}>
                                    Close
                                </Button>
                            </>
                        )}
                    </div>
                )}
            </EnhancedDrawer>
            <SkillDiscardDialog
                open={asking}
                title="Discard unsaved changes?"
                description="This skill has changes that are not saved. They will be lost."
                onCancel={() => setAsking(false)}
                onDiscard={close}
            />
        </>
    )
}
