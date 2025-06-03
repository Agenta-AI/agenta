import {memo} from "react"

import clsx from "clsx"

import {renderMap} from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/helpers"

import {AnnotateCollapseContentProps} from "../types"

const AnnotateCollapseContent = ({metadata, annSlug, onChange}: AnnotateCollapseContentProps) => {
    const renderer = renderMap[metadata.type as keyof typeof renderMap] as
        | ((props: any) => React.ReactElement)
        | undefined

    return renderer?.({
        withTooltip: false,
        metadata: metadata,
        value: metadata.value,
        handleChange: (value: any) => onChange(annSlug, metadata.title, value),
        as: metadata.as,
        disabled: metadata.disabled,
        options: metadata.options,
        placeholder: metadata.placeholder,
        mode: metadata.mode,
        allowClear: metadata.allowClear,
        disableClear: metadata.disableClear,
        className: clsx(["[&_.ant-input-number]:w-[70px]"]),
    })
}

export default memo(AnnotateCollapseContent)
