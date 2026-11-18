import {useState} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {skillsResolveDataAtom, skillsResolveQueryAtom} from "@agenta/skills/state"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
    Spinner,
} from "@agenta/ui/ui"
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
    const query = useAtomValue(skillsResolveQueryAtom)
    const registry = useAtomValue(skillsResolveDataAtom)
    const [dirty, setDirty] = useState(false)
    const [asking, setAsking] = useState(false)
    const match = slug
        ? registry.find((skill) => skill.workflow_slug === slug || skill.skill_name === slug)
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
                styles={{body: {padding: 20}}}
            >
                {workflowId ? (
                    <SkillDetailView
                        projectId={projectId}
                        workflowId={workflowId}
                        onArchived={close}
                        onDirtyChange={setDirty}
                        top={
                            <div className="flex justify-end">
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Close"
                                    onClick={requestClose}
                                >
                                    <X size={16} />
                                </Button>
                            </div>
                        }
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
            <AlertDialog open={asking} onOpenChange={(next) => !next && setAsking(false)}>
                <AlertDialogContent className="sm:max-w-[400px]">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This skill has changes that are not saved. They will be lost.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button variant="outline">Keep editing</Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button variant="destructive" onClick={close}>
                                Discard
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
