import {Tag} from "antd"

import ImagePreview from "@/oss/components/Common/ImagePreview"
import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"

import type {PromptPreviewSection} from "../types"

interface PromptPreviewProps {
    sections: PromptPreviewSection[]
}

const PromptPreview = ({sections}: PromptPreviewProps) => {
    if (!sections.length) return null

    return (
        <div className="flex flex-col gap-3">
            {sections.map((section, index) => {
                const tagContent =
                    section.role?.trim() || section.label?.trim() || `Message ${index + 1}`
                const normalizedTag = tagContent.toLowerCase()
                const normalizedLabel = section.label?.trim().toLowerCase()
                const labelIsDistinct =
                    Boolean(normalizedLabel) && normalizedLabel !== normalizedTag
                const _secondaryLabel = labelIsDistinct
                    ? section.label
                    : section.role
                      ? `Message ${index + 1}`
                      : undefined

                const headerName = (
                    <div className="flex items-center gap-2">
                        <Tag className="!m-0 capitalize">{tagContent}</Tag>
                        {/* {secondaryLabel ? (
                            <span className="text-xs font-medium uppercase text-[#475467]">
                                {secondaryLabel}
                            </span>
                        ) : null} */}
                    </div>
                )

                return (
                    <SimpleSharedEditor
                        key={section.id || `${section.label}-${index}`}
                        headerName={headerName}
                        headerClassName="!items-center"
                        editorType="border"
                        state="readOnly"
                        disabled
                        initialValue={section.content || ""}
                        className="!shadow-none [&_.agenta-editor-wrapper]:!w-full"
                        editorClassName="!text-sm"
                        isMinimizeVisible={false}
                        isFormatVisible={false}
                        isCopyVisible
                        showTextToMdOutside
                        footer={
                            section.attachments.length ? (
                                <div className="flex flex-wrap gap-2 pt-2">
                                    {section.attachments.map((attachment, attachmentIndex) => (
                                        <ImagePreview
                                            key={`${section.id}-attachment-${attachmentIndex}`}
                                            src={attachment.url}
                                            alt={
                                                attachment.alt ||
                                                `Attachment ${attachmentIndex + 1}`
                                            }
                                            size={56}
                                        />
                                    ))}
                                </div>
                            ) : undefined
                        }
                    />
                )
            })}
        </div>
    )
}

export default PromptPreview
