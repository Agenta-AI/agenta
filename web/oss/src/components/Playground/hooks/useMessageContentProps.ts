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
        baseContentProperty,
        baseRoleProperty,
        computedText,
    }
}
