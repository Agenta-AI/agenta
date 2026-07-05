import React, {useCallback, useRef} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {FileArchive, Image as ImageIcon, Paperclip} from "@phosphor-icons/react"

import {cn, flexLayouts, gapClasses, textColors} from "../../utils/styles"

interface AttachmentButtonProps {
    onAddImage: (imageUrl: string) => void
    onAddFile: (fileData: string, filename: string, format: string) => void
    disabled?: boolean
}

/**
 * Dropdown button for adding attachments (images and files) to messages.
 */
export const AttachmentButton: React.FC<AttachmentButtonProps> = ({
    onAddImage,
    onAddFile,
    disabled,
}) => {
    const imageInputRef = useRef<HTMLInputElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleImageSelect = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0]
            if (!file) return

            const reader = new FileReader()
            reader.onload = () => {
                onAddImage(reader.result as string)
            }
            reader.readAsDataURL(file)
            // Reset input
            if (imageInputRef.current) imageInputRef.current.value = ""
        },
        [onAddImage],
    )

    const handleFileSelect = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0]
            if (!file) return

            const reader = new FileReader()
            reader.onload = () => {
                onAddFile(reader.result as string, file.name, file.type)
            }
            reader.readAsDataURL(file)
            // Reset input
            if (fileInputRef.current) fileInputRef.current.value = ""
        },
        [onAddFile],
    )

    return (
        <>
            <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleImageSelect}
            />
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt,.csv,.json,.xml"
                hidden
                onChange={handleFileSelect}
            />
            <DropdownMenu>
                <DropdownMenuTrigger
                    className={cn(
                        "inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent size-7 text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
                        textColors.icon,
                        textColors.iconHover,
                    )}
                    disabled={disabled}
                    title="Add attachment"
                >
                    <Paperclip size={14} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                        <span className={cn(flexLayouts.rowCenter, gapClasses.sm)}>
                            <ImageIcon size={14} />
                            <span>Upload image</span>
                        </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                        <span className={cn(flexLayouts.rowCenter, gapClasses.sm)}>
                            <FileArchive size={14} />
                            <span>Attach document</span>
                        </span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    )
}

export default AttachmentButton
