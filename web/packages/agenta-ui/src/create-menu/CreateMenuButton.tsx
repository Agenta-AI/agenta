// The `+ New …` menu every creation entry point shares: tinted-tile rows, one per way to create.
import {Fragment, useRef, type ReactNode} from "react"

import {GitBranch, PencilSimple, Plus, UploadSimple} from "@phosphor-icons/react"

import {AGENT_ICON_CHIP_CLASS, agentIconChipStyle} from "../agent-icon/AgentIcon"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    LoadingButton,
    type ButtonProps,
} from "../components/ui"
import {cn} from "../utils/styles"

/** Each kind's tile: olive for writing, the palette's teal for an upload, its blue for a repo. */
const TILES = {
    write: {color: "#6b7d3f", icon: <PencilSimple size={15} />},
    upload: {color: "#0F766E", icon: <UploadSimple size={15} />},
    import: {color: "#1668DC", icon: <GitBranch size={15} />},
}

export interface CreateMenuOption {
    kind: keyof typeof TILES
    title: string
    hint: string
    onSelect?: () => void
    /** Opens the file picker instead; the picked files arrive here. */
    onFiles?: (files: FileList) => void
    accept?: string
    multiple?: boolean
    disabled?: boolean
}

export interface CreateMenuButtonProps {
    label: string
    /** The first row stands apart from the rest under a separator. */
    options: CreateMenuOption[]
    /** Rendered under the rows, after a separator — e.g. a link to a gallery. */
    footer?: ReactNode
    variant?: ButtonProps["variant"]
    size?: ButtonProps["size"]
    disabled?: boolean
    loading?: boolean
    className?: string
}

export function CreateMenuButton({
    label,
    options,
    footer,
    variant = "default",
    size,
    disabled,
    loading,
    className,
}: CreateMenuButtonProps) {
    const fileInput = useRef<HTMLInputElement>(null)
    const fileOption = useRef<CreateMenuOption | null>(null)
    const pickFiles = (option: CreateMenuOption) => {
        const input = fileInput.current
        if (!input) return
        fileOption.current = option
        input.accept = option.accept ?? ""
        input.multiple = Boolean(option.multiple)
        // Inside the row's own click: a picker opened later has no gesture to honour.
        input.click()
    }
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled || loading}>
                <LoadingButton
                    variant={variant}
                    size={size}
                    loading={loading}
                    className={cn("gap-1.5", className)}
                >
                    {loading ? null : <Plus size={14} />}
                    {label}
                </LoadingButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-[320px]">
                {options.map((option, index) => (
                    <Fragment key={option.kind}>
                        {index === 1 ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuItem
                            disabled={option.disabled}
                            onSelect={() =>
                                option.onFiles ? pickFiles(option) : option.onSelect?.()
                            }
                        >
                            <span
                                aria-hidden
                                className={cn(
                                    "flex size-7 shrink-0 items-center justify-center rounded-md",
                                    AGENT_ICON_CHIP_CLASS,
                                )}
                                style={agentIconChipStyle(TILES[option.kind].color)}
                            >
                                {TILES[option.kind].icon}
                            </span>
                            <span className="flex min-w-0 flex-col py-0.5">
                                <span className="truncate text-sm text-colorText">
                                    {option.title}
                                </span>
                                <span className="truncate text-xs text-colorTextTertiary">
                                    {option.hint}
                                </span>
                            </span>
                        </DropdownMenuItem>
                    </Fragment>
                ))}
                {footer ? (
                    <>
                        <DropdownMenuSeparator />
                        {footer}
                    </>
                ) : null}
            </DropdownMenuContent>
            {options.some((option) => option.onFiles) ? (
                <input
                    ref={fileInput}
                    type="file"
                    className="hidden"
                    aria-hidden
                    tabIndex={-1}
                    onChange={(event) => {
                        const list = event.target.files
                        if (list && list.length) fileOption.current?.onFiles?.(list)
                        event.target.value = ""
                    }}
                />
            ) : null}
        </DropdownMenu>
    )
}
