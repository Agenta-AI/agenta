import {useEffect, useState} from "react"

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
                    onClose={onClose}
                    onSubmit={(name) => onSubmit({name})}
                />
            )}
            renderRenameDialog={({open, onClose, onSubmit, pending, project}) => (
                <NameSheet
                    open={open}
                    title="Rename project"
                    submitLabel="Save"
                    pending={pending}
                    initialValue={project?.project_name ?? ""}
                    onClose={onClose}
                    onSubmit={(name) => onSubmit({name})}
                />
            )}
            renderDeleteDialog={({open, onClose, onSubmit, pending, project}) => (
                <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
                    <SheetContent side="responsive">
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

/**
 * Owns the draft itself, seeded from `initialValue` each time it opens. It used to render
 * `value || initialValue`, which meant clearing the field silently put the old name back —
 * uncleanable, and Save then sent the name the user had just deleted.
 */
const NameSheet = ({
    open,
    title,
    description,
    submitLabel,
    pending,
    initialValue = "",
    onClose,
    onSubmit,
}: {
    open: boolean
    title: string
    description?: string
    submitLabel: string
    pending: boolean
    initialValue?: string
    onClose: () => void
    onSubmit: (name: string) => void
}) => {
    const [value, setValue] = useState(initialValue)

    useEffect(() => {
        if (open) setValue(initialValue)
    }, [open, initialValue])

    return (
        <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
            <SheetContent side="responsive">
                <SheetHeader>
                    <SheetTitle>{title}</SheetTitle>
                    {description ? <SheetDescription>{description}</SheetDescription> : null}
                </SheetHeader>
                <div className="px-4">
                    <Input
                        autoFocus
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        placeholder="Project name"
                    />
                </div>
                <SheetFooter>
                    <Button
                        disabled={pending || !value.trim()}
                        onClick={() => onSubmit(value.trim())}
                    >
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
