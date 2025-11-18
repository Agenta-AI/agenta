import {ReactNode} from "react"

import clsx from "clsx"
import dynamic from "next/dynamic"

import ImagePreview from "@/oss/components/Common/ImagePreview"
import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import SimpleDropdownSelect from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/SimpleDropdownSelect"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"

const Tooltip = dynamic(() => import("antd").then((mod) => mod.Tooltip), {ssr: false})

/**
 * Renders an array of chat messages (OpenAI format) as readonly SharedEditor blocks.
 * Returns an array of <section> nodes so callers can embed them directly in their JSX.
 */
export function renderChatMessages({
    keyPrefix,
    rawJson,
    view,
    editorType = "shared",
}: {
    keyPrefix: string
    rawJson: string
    view?: "table" | "single"
    editorType?: "simple" | "shared" | "normal"
}): ReactNode[] {
    let messages: {role: string; content: any}[] = []
    try {
        messages = JSON.parse(rawJson)
        if (!Array.isArray(messages))
            return [<span key={`${keyPrefix}-invalid`}>{String(rawJson)}</span>]
    } catch {
        return [<span key={`${keyPrefix}-invalid`}>{String(rawJson)}</span>]
    }

    if (view === "table") {
        return messages.map((msg, i) => {
            const textContent = Array.isArray(msg.content)
                ? msg.content.find((content) => content.type === "text")?.text
                : msg.content
            const images = Array.isArray(msg.content)
                ? msg.content.filter((content) => content.type === "image_url")
                : []
            const files = Array.isArray(msg.content)
                ? msg.content.filter((content) => content.type === "file")
                : []
            const showDivider = i < messages.length - 1

            return (
                <section
                    key={`${keyPrefix}-${i}`}
                    className="w-full flex flex-col gap-2 text-xs text-gray-700"
                >
                    <span className="capitalize text-[11px] text-gray-500">{msg.role}</span>
                    {textContent ? (
                        <pre className="whitespace-pre-wrap break-words">{textContent}</pre>
                    ) : null}
                    {images.length ? (
                        <div className="flex flex-wrap gap-2">
                            {images.map((imageContent: any, index: number) => (
                                <ImagePreview
                                    key={`msg-image-${index}`}
                                    src={imageContent.image_url.url}
                                    alt="Preview"
                                    size={48}
                                />
                            ))}
                        </div>
                    ) : null}
                    {files.length ? (
                        <div className="flex flex-col gap-1">
                            {files.map((fileContent: any, index: number) => (
                                <div key={`msg-file-${index}`} className="mt-1 text-xs">
                                    <a
                                        href={fileContent.file?.file_id}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[#1677ff]"
                                    >
                                        {fileContent.file?.name || `Document ${index + 1}`}
                                    </a>
                                    {fileContent.file?.mime_type && (
                                        <span className="text-[#758391] ml-1">
                                            ({fileContent.file?.mime_type})
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {showDivider ? (
                        <div className="h-px w-full bg-slate-200/90 dark:bg-slate-700/60 rounded-full" />
                    ) : null}
                </section>
            )
        })
    }

    return messages.map((msg, i) => {
        const textContent = Array.isArray(msg.content)
            ? msg.content.find((content) => content.type === "text")?.text
            : msg.content
        const images = Array.isArray(msg.content)
            ? msg.content.filter((content) => content.type === "image_url")
            : []
        const files = Array.isArray(msg.content)
            ? msg.content.filter((content) => content.type === "file")
            : []
        const showDivider = i < messages.length - 1

        return (
            <section
                key={`${keyPrefix}-${i}`}
                className={clsx([
                    "w-full flex flex-col gap-2",
                    {"[&_.agenta-shared-editor]:!p-0": view === "table"},
                ])}
            >
                {editorType === "simple" ? (
                    <SimpleSharedEditor
                        key={`${keyPrefix}-${i}`}
                        handleChange={() => {}}
                        headerName={msg.role}
                        headerClassName="capitalize"
                        initialValue={textContent}
                        editorType="borderless"
                        state="readOnly"
                        placeholder="N/A"
                        disabled
                        readOnly
                        editorClassName="!text-xs"
                        className="!w-[97.5%]"
                        editorProps={{enableResize: true}}
                        footer={
                            <div className="w-full">
                                {images.map((imageContent: any, index: number) => (
                                    <ImagePreview
                                        key={`msg-image-${index}`}
                                        src={imageContent.image_url.url}
                                        alt="Preview"
                                        size={48}
                                    />
                                ))}
                                {files.map((fileContent: any, index: number) => (
                                    <div key={`msg-file-${index}`} className="mt-1 text-xs">
                                        <a
                                            href={fileContent.file?.file_id}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-[#1677ff]"
                                        >
                                            {fileContent.file?.name || `Document ${index + 1}`}
                                        </a>
                                        {fileContent.file?.mime_type && (
                                            <span className="text-[#758391] ml-1">
                                                ({fileContent.file?.mime_type})
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        }
                    />
                ) : editorType === "normal" ? (
                    <div className="w-full flex flex-col gap-2">
                        <span className="capitalize">{msg.role}</span>
                        {textContent}
                    </div>
                ) : (
                    <SharedEditor
                        state={view === "single" ? "readOnly" : "default"}
                        header={
                            view === "table" ? (
                                <Tooltip title={`Message role: ${msg.role}`} className="w-fit">
                                    <span className="capitalize italic">{msg.role}</span>
                                </Tooltip>
                            ) : (
                                <div className="w-full flex items-center justify-between">
                                    <SimpleDropdownSelect
                                        value={msg.role}
                                        options={[
                                            {label: "user", value: "user"},
                                            {label: "assistant", value: "assistant"},
                                            {label: "system", value: "system"},
                                            {label: "function", value: "function"},
                                            {label: "tool", value: "tool"},
                                        ]}
                                        onChange={() => {}}
                                        disabled
                                    />
                                </div>
                            )
                        }
                        initialValue={textContent}
                        className="hover:!border-[transparent]"
                        editorClassName="!text-xs"
                        editorProps={{enableResize: true}}
                        disabled
                        footer={
                            <div className="w-full">
                                {images.map((imageContent: any, index: number) => (
                                    <ImagePreview
                                        key={`msg-image-${index}`}
                                        src={imageContent.image_url.url}
                                        alt="Preview"
                                        size={48}
                                    />
                                ))}
                                {files.map((fileContent: any, index: number) => (
                                    <div key={`msg-file-${index}`} className="mt-1 text-xs">
                                        <a
                                            href={fileContent.file?.file_id}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-[#1677ff]"
                                        >
                                            {fileContent.file?.name || `Document ${index + 1}`}
                                        </a>
                                        {fileContent.file?.mime_type && (
                                            <span className="text-[#758391] ml-1">
                                                ({fileContent.file?.mime_type})
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        }
                    />
                )}

                {showDivider ? (
                    <div className="h-px w-full bg-slate-200/90 dark:bg-slate-700/60 rounded-full" />
                ) : null}
            </section>
        )
    })
}
