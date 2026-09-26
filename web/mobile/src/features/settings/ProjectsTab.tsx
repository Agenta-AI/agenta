import {useEffect, useState} from "react"

import type {ProjectsResponse} from "@agenta/entities/project"
import {ProjectsPage} from "@agenta/settings-ui"
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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
} from "@agenta/ui/ui"

interface Props {
    projects: ProjectsResponse[]
    isLoading: boolean
    workspaceId: string
}

/**
 * Mobile binding: the shared projects table, with create / rename / delete as modals
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
                <AlertDialog
                    open={open}
                    onOpenChange={(next) => (next || pending ? undefined : onClose())}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete project</AlertDialogTitle>
                            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <p className="m-0 text-sm">
                            Permanently deletes {project?.project_name}, including all of its
                            agents, datasets and deployments.
                        </p>
                        <AlertDialogFooter>
                            <AlertDialogCancel asChild>
                                <Button variant="outline" onClick={onClose} disabled={pending}>
                                    Cancel
                                </Button>
                            </AlertDialogCancel>
                            {/* The page closes it once the delete lands. */}
                            <AlertDialogAction asChild>
                                <Button
                                    variant="destructive"
                                    disabled={pending}
                                    onClick={(event) => {
                                        event.preventDefault()
                                        onSubmit()
                                    }}
                                >
                                    {pending ? "Deleting…" : "Delete project"}
                                </Button>
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
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
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description ? <DialogDescription>{description}</DialogDescription> : null}
                </DialogHeader>
                <div>
                    <Input
                        autoFocus
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        placeholder="Project name"
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button
                        disabled={pending || !value.trim()}
                        onClick={() => onSubmit(value.trim())}
                    >
                        {submitLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
