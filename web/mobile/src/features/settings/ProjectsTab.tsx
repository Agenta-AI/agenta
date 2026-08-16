import {useState} from "react"

import type {ProjectsResponse} from "@agenta/entities/project"
import {ProjectsPage} from "@agenta/settings-ui"

import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"

interface Props {
    projects: ProjectsResponse[]
    isLoading: boolean
    workspaceId: string
}

/**
 * Mobile binding: the shared projects table, with create / rename / delete as bottom sheets
 * (the desktop uses antd modals — same verbs, each app's own idiom). The mutations live in
 * ProjectsPage; this only supplies the surfaces that collect the input.
 */
export const ProjectsTab = ({projects, isLoading, workspaceId}: Props) => {
    // `null` is "untouched", which is what lets a cleared field stay cleared.
    const [name, setName] = useState<string | null>(null)

    return (
        <ProjectsPage
            projects={projects}
            isLoading={isLoading}
            workspaceId={workspaceId}
            renderCreateDialog={({open, onClose, onSubmit, pending}) => (
                <NameSheet
                    open={open}
                    title="New project"
                    description="Projects group your agents, datasets and deployments."
                    submitLabel="Create"
                    pending={pending}
                    value={name ?? ""}
                    touched={name !== null}
                    onValueChange={setName}
                    onClose={() => {
                        setName(null)
                        onClose()
                    }}
                    onSubmit={() => onSubmit({name: (name ?? "").trim()})}
                />
            )}
            renderRenameDialog={({open, onClose, onSubmit, pending, project}) => (
                <NameSheet
                    open={open}
                    title="Rename project"
                    submitLabel="Save"
                    pending={pending}
                    // The sheet mounts before a row is chosen; the row's name seeds an
                    // untouched field only.
                    value={name ?? project?.project_name ?? ""}
                    touched={name !== null}
                    onValueChange={setName}
                    onClose={() => {
                        setName(null)
                        onClose()
                    }}
                    onSubmit={() => onSubmit({name: (name ?? project?.project_name ?? "").trim()})}
                />
            )}
            renderDeleteDialog={({open, onClose, onSubmit, pending, project}) => (
                <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
                    <SheetContent side="bottom">
                        <SheetHeader>
                            <SheetTitle>Delete project</SheetTitle>
                            <SheetDescription>This cannot be undone.</SheetDescription>
                        </SheetHeader>
                        <p className="px-4 text-sm">
                            Permanently deletes {project?.project_name}, including all of its
                            agents, datasets and deployments.
                        </p>
                        <SheetFooter>
                            <Button
                                variant="destructive"
                                disabled={pending}
                                onClick={() => onSubmit()}
                            >
                                Delete project
                            </Button>
                            <Button variant="outline" onClick={onClose} disabled={pending}>
                                Cancel
                            </Button>
                        </SheetFooter>
                    </SheetContent>
                </Sheet>
            )}
        />
    )
}

const NameSheet = ({
    open,
    title,
    description,
    submitLabel,
    pending,
    value,
    touched,
    onValueChange,
    onClose,
    onSubmit,
}: {
    open: boolean
    title: string
    description?: string
    submitLabel: string
    pending: boolean
    value: string
    /** The field has been typed in, so an empty one is the user's doing and worth saying. */
    touched: boolean
    onValueChange: (value: string) => void
    onClose: () => void
    onSubmit: () => void
}) => {
    const isEmpty = !value.trim()

    return (
        <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
            <SheetContent side="bottom">
                <SheetHeader>
                    <SheetTitle>{title}</SheetTitle>
                    {description ? <SheetDescription>{description}</SheetDescription> : null}
                </SheetHeader>
                <div className="px-4">
                    <Input
                        autoFocus
                        value={value}
                        onChange={(event) => onValueChange(event.target.value)}
                        placeholder="Project name"
                    />
                    {touched && isEmpty ? (
                        <p className="m-0 pt-2 text-xs text-colorError">A name is required.</p>
                    ) : null}
                </div>
                <SheetFooter>
                    <Button disabled={pending || isEmpty} onClick={onSubmit}>
                        {submitLabel}
                    </Button>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
