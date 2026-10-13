import {CREATE_MENU_COLORS, CreateMenuButton, type CreateMenuOption} from "@agenta/ui/create-menu"
import {DropdownMenuItem} from "@agenta/ui/ui"
import {
    ArrowRightIcon,
    GitBranchIcon,
    PencilSimpleIcon,
    UploadSimpleIcon,
} from "@phosphor-icons/react"
import Link from "next/link"

export interface NewAgentButtonProps {
    /** Blank create. The only entry every surface has. */
    onCreateBlank: () => void
    /** The picked template .zip. Absent ⇒ no Upload row. */
    onUpload?: (file: File) => void
    /** Opens the import-from-repo flow. Absent ⇒ no Import row. */
    onImport?: () => void
    /** The template gallery. Omit and the footer link goes with it. */
    browseHref?: string
    label?: string
    /** A create is in flight — the trigger reports it rather than accepting a second click. */
    loading?: boolean
    variant?: "default" | "outline"
    size?: "sm" | "default"
    /** On the trigger — a phone toolbar sizes it down from here. */
    className?: string
}

/** The one way to create an agent: from scratch, from an uploaded package, or from a repo. */
export const NewAgentButton = ({
    onCreateBlank,
    onUpload,
    onImport,
    browseHref,
    label = "New agent",
    ...button
}: NewAgentButtonProps) => {
    const options: CreateMenuOption[] = [
        {
            key: "blank",
            color: CREATE_MENU_COLORS.write,
            icon: <PencilSimpleIcon size={15} />,
            title: "Start from scratch",
            hint: "Start with an empty agent and shape it in chat",
            onSelect: onCreateBlank,
        },
    ]
    if (onUpload)
        options.push({
            key: "upload",
            color: CREATE_MENU_COLORS.upload,
            icon: <UploadSimpleIcon size={15} />,
            title: "Upload",
            hint: "An agent template .zip",
            accept: ".zip,application/zip",
            onFiles: (files) => onUpload(files[0]),
            separated: true,
        })
    if (onImport)
        options.push({
            key: "import",
            color: CREATE_MENU_COLORS.import,
            icon: <GitBranchIcon size={15} />,
            title: "Import from a repo",
            hint: "Scan a public GitHub repository for agent templates",
            onSelect: onImport,
            separated: !onUpload,
        })
    return (
        <CreateMenuButton
            label={label}
            options={options}
            footer={
                browseHref ? (
                    <DropdownMenuItem asChild>
                        <Link
                            href={browseHref}
                            className="inline-flex items-center gap-1 !text-colorPrimary"
                        >
                            Browse all templates
                            <ArrowRightIcon size={12} />
                        </Link>
                    </DropdownMenuItem>
                ) : undefined
            }
            {...button}
        />
    )
}
