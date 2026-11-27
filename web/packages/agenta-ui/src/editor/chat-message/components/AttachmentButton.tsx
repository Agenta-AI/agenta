import React, {useCallback, useRef} from "react"

import {useT} from "@agenta/i18n"
import uiChatCatalog from "@agenta/i18n/catalogs/ui.chat"
import {FileArchive, Image as ImageIcon, Paperclip} from "@phosphor-icons/react"

import {Button} from "../../../primitives/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../../../primitives/dropdown-menu"

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
    const t = useT(uiChatCatalog)
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
                <DropdownMenuTrigger asChild disabled={disabled}>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        className="text-muted-foreground hover:text-foreground"
                        title={t("ui.chat.addAttachment")}
                    >
                        {<Paperclip size={14} />}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                        <span className="flex items-center gap-2">
                            <ImageIcon size={14} />
                            <span>{t("ui.chat.uploadImage")}</span>
                        </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                        <span className="flex items-center gap-2">
                            <FileArchive size={14} />
                            <span>{t("ui.chat.attachDocument")}</span>
                        </span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    )
}

export default AttachmentButton
