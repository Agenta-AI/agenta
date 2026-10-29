import {CreateMenuButton, type CreateMenuOption} from "@agenta/ui/create-menu"
import {DropdownMenuItem} from "@agenta/ui/ui"
import {ArrowRightIcon} from "@phosphor-icons/react"
import Link from "next/link"

export interface NewAgentButtonProps {
    onCreateBlank: () => void
    /** The picked template .zip. Absent ⇒ no Upload row. */
    onUpload?: (file: File) => void
    /** Opens the import-from-repo flow. Absent ⇒ no Import row. */
    onImport?: () => void
    /** The template gallery. */
    browseHref: string
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
            kind: "write",
            title: "Start from scratch",
            hint: "Start with an empty agent and shape it in chat",
            onSelect: onCreateBlank,
        },
    ]
    if (onUpload)
        options.push({
            kind: "upload",
            title: "Upload",
            hint: "An agent template .zip",
            accept: ".zip,application/zip",
            onFiles: (files) => onUpload(files[0]),
        })
    if (onImport)
        options.push({
            kind: "import",
            title: "Import from a repo",
            hint: "Scan a public GitHub repository for agent templates",
            onSelect: onImport,
        })
    return (
        <CreateMenuButton
            label={label}
            options={options}
            footer={
                <DropdownMenuItem asChild>
                    <Link
                        href={browseHref}
                        className="inline-flex items-center gap-1 !text-colorPrimary"
                    >
                        Browse all templates
                        <ArrowRightIcon size={12} />
                    </Link>
                </DropdownMenuItem>
            }
            {...button}
        />
    )
}
