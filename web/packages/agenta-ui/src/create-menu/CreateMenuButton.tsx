// The `+ New …` menu every creation entry point shares: tinted-tile rows, one per way to create.
import {Fragment, useRef, type ReactNode} from "react"

import {GitBranch, PencilSimple, Plus, UploadSimple} from "@phosphor-icons/react"

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

/** Each kind's tile is a neutral Mark; the icon tells the kinds apart (COLOR-05). */
const TILES = {
    write: {icon: <PencilSimple size={14} />},
    upload: {icon: <UploadSimple size={14} />},
    import: {icon: <GitBranch size={14} />},
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
                            onSelect={() =>
                                option.onFiles ? pickFiles(option) : option.onSelect?.()
                            }
                        >
                            <span
                                aria-hidden
                                className="flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground"
                            >
                                {TILES[option.kind].icon}
                            </span>
                            <span className="flex min-w-0 flex-col py-0.5">
                                <span className="truncate text-label text-foreground">
                                    {option.title}
                                </span>
                                <span className="truncate text-meta text-muted-foreground">
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
