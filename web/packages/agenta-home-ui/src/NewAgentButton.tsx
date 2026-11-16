import {useT} from "@agenta/i18n"
import newAgentCatalog from "@agenta/i18n/catalogs/home.newAgent"
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
    label,
    ...button
}: NewAgentButtonProps) => {
    const t = useT(newAgentCatalog)
    const options: CreateMenuOption[] = [
        {
            kind: "write",
            title: t("home.newAgent.scratchTitle"),
            hint: t("home.newAgent.scratchHint"),
            onSelect: onCreateBlank,
        },
    ]
    if (onUpload)
        options.push({
            kind: "upload",
            title: t("home.newAgent.uploadTitle"),
            hint: t("home.newAgent.uploadHint"),
            accept: ".zip,application/zip",
            onFiles: (files) => onUpload(files[0]),
        })
    if (onImport)
        options.push({
            kind: "import",
            title: t("home.newAgent.importTitle"),
            hint: t("home.newAgent.importHint"),
            onSelect: onImport,
        })
    return (
        <CreateMenuButton
            label={label ?? t("home.newAgent.label")}
            options={options}
            footer={
                <DropdownMenuItem asChild>
                    <Link
                        href={browseHref}
                        className="inline-flex items-center gap-1 !text-colorPrimary"
                    >
                        {t("home.newAgent.browseAll")}
                        <ArrowRightIcon size={12} />
                    </Link>
                </DropdownMenuItem>
            }
            {...button}
        />
    )
}
