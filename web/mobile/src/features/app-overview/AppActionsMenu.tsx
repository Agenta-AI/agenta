import {useState} from "react"

import type {Workflow} from "@agenta/entities/workflow"
import {message} from "@agenta/ui/app-message"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {Copy, DotsThreeVertical, PencilSimple, Trash} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import {useProjectPermission} from "../context/useProjectPermission"
import {useConfirmModal} from "../settings/useConfirmModal"

import {useAppArchive} from "./useAppArchive"

// The dialog and its details cost nothing until a reader opens Rename.
const RenameAppDialog = dynamic(
    () => import("./RenameAppDialog").then((module) => module.RenameAppDialog),
    {ssr: false},
)

/**
 * The actions of the app on its overview: Rename, Copy Slug, and Archive. Rename and Archive need
 * `edit_workflows`, so a reader sees only Copy Slug, and no menu at all for an app with no slug.
 * An evaluator gets Copy Slug only: archiving one must first check the evaluation runs that use it,
 * which the Evaluators list does.
 */
export const AppActionsMenu = ({
    projectId,
    app,
    base,
    evaluator = false,
}: {
    projectId: string
    app: Workflow
    base: string
    evaluator?: boolean
}) => {
    const canEdit = useProjectPermission(projectId, "edit_workflows") && !evaluator
    const [renameOpen, setRenameOpen] = useState(false)
    const {confirm, modal} = useConfirmModal()
    const archive = useAppArchive({projectId, appId: app.id, base})
    const slug = app.slug ?? null

    if (!canEdit && !slug) return null

    const copySlug = async () => {
        if (slug && (await copyToClipboard(slug))) message.success("Slug copied")
        else message.error("Couldn't copy the slug")
    }

    const askArchive = () =>
        confirm({
            title: "Archive app",
            message: `${app.name || app.slug || "This app"} will move to archived apps.`,
            okText: "Archive app",
            danger: true,
            onOk: archive,
        })

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={evaluator ? "Evaluator actions" : "App actions"}
                    >
                        <DotsThreeVertical aria-hidden className="size-4" weight="bold" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[200px]">
                    {canEdit ? (
                        <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                            <PencilSimple aria-hidden size={14} />
                            Rename
                        </DropdownMenuItem>
                    ) : null}
                    {slug ? (
                        <DropdownMenuItem onSelect={() => void copySlug()}>
                            <Copy aria-hidden size={14} />
                            Copy Slug
                        </DropdownMenuItem>
                    ) : null}
                    {canEdit ? (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={askArchive}>
                                <Trash aria-hidden size={14} />
                                Archive app
                            </DropdownMenuItem>
                        </>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
            {renameOpen ? (
                <RenameAppDialog
                    projectId={projectId}
                    app={app}
                    onClose={() => setRenameOpen(false)}
                />
            ) : null}
            {modal}
        </>
    )
}
