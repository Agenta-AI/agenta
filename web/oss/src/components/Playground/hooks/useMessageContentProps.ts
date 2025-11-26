import {useMemo} from "react"

interface MessageLike {
    role?: {value?: string; __id?: string}
    content?: {value?: any; __id?: string}
}

import {useMessageContentHandlers} from "@/oss/components/Playground/hooks/useMessageContentHandlers"

export function useMessageContentProps(message?: MessageLike | null) {
    const {computeDisplayValue} = useMessageContentHandlers()
    const baseProperty = useMemo(() => {
        const content = message?.content
        if (!content) return null
        const val = content.value
        if (Array.isArray(val)) {
            const textItem = val.find((item: any) => (item?.type?.value ?? item?.type) === "text")
            return textItem?.text || null
        }
        return content
    }, [message?.content])

    const isTool = (message?.role?.value ?? "") === "tool"

    const baseImageProperties = useMemo(() => {
        const val = message?.content?.value
        if (!Array.isArray(val)) return [] as any[]
        const nodes = val
            .map((v: any) => {
                if (!!v && typeof v === "object") {
                    if ("image_url" in v) return (v.image_url as any)?.url
                    if ("imageUrl" in v) return (v.imageUrl as any)?.url
                }
                return undefined
            })
            .filter((node: any) => node != null)
        return nodes
    }, [message?.content?.value])

    const baseFileProperties = useMemo(() => {
        const val = message?.content?.value
        if (!Array.isArray(val)) return [] as any[]
        const normalizeFileProp = (fileNode: any | undefined, keyCandidates: string[]) => {
            for (const key of keyCandidates) {
                if (fileNode && typeof fileNode === "object" && key in fileNode) {
                    return fileNode[key]
                }
            }
            return undefined
        }

        const nodes = val
            .map((v: any) => {
                if (!!v && typeof v === "object") {
                    const nodeWithFile = "file" in v ? (v.file as any) : undefined
                    if (!nodeWithFile) return undefined

                    const fileIdProp = normalizeFileProp(nodeWithFile, [
                        "file_id",
                        "fileId",
                        "id",
                        "url",
                    ])
                    const fileDataProp = normalizeFileProp(nodeWithFile, [
                        "file_data",
                        "fileData",
                        "data",
                    ])
                    const nameProp = normalizeFileProp(nodeWithFile, [
                        "name",
                        "filename",
                        "file_name",
                    ])
                    const mimeProp = normalizeFileProp(nodeWithFile, [
                        "mime_type",
                        "mimeType",
                        "content_type",
                        "type",
                        "format",
                    ])
                    const formatProp = normalizeFileProp(nodeWithFile, ["format", "type"])

                    // Need either file_id or file_data - prefer file_id if both exist
                    if (!fileIdProp && !fileDataProp) return undefined

                    return {
                        fileId: fileIdProp,
                        fileData: fileDataProp,
                        name: nameProp,
                        mimeType: mimeProp,
                        format: formatProp,
                    }
                }
                return undefined
            })
            .filter((node: any) => node != null)
        return nodes
    }, [message?.content?.value])

    const baseContentProperty = message?.content || null
    const baseRoleProperty = message?.role || null

    const computedText = useMemo(
        () =>
            computeDisplayValue({
                propsInitialValue: undefined,
                value: (baseContentProperty as any)?.value,
                isFunction: false,
                isTool,
                contentProperty: baseContentProperty as any,
            }),
        [computeDisplayValue, baseContentProperty, isTool],
    )

    return {
        baseProperty,
        isTool,
        baseImageProperties,
        baseFileProperties,
        baseContentProperty,
        baseRoleProperty,
        computedText,
    }
}
