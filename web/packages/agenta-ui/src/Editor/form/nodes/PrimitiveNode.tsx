import {type FC, type ReactNode, useCallback, useEffect, useState} from "react"

import clsx from "clsx"

import EditableText from "../../../components/presentational/editable/EditableText"
import {Input} from "../../../components/ui/input"
import {AutosizeTextarea} from "../../../components/ui/input-composed"
import {InputNumber} from "../../../components/ui/input-number"
import {Switch} from "../../../components/ui/switch"
import TreeRow from "../shared/TreeRow"

import {BaseNodeProps, CustomRenderFn} from "./NodeTypes"

export interface PrimitiveNodeProps extends BaseNodeProps {
    customRender?: CustomRenderFn
}

const PrimitiveNodeComponent: FC<PrimitiveNodeProps> = ({
    className,
    path,
    k,
    value,
    depth,
    onChange,
    handleRename,
}) => {
    // Local buffer: the value echo round-trips through the root state, so typing would
    // stutter if the input read the prop directly.
    const [localValue, setLocalValue] = useState<unknown>(value)

    useEffect(() => {
        setLocalValue(value)
    }, [value])

    const emit = useCallback(
        (next: unknown) => {
            setLocalValue(next)
            onChange(path, next)
        },
        [onChange, path],
    )

    const handleRenameKey = useCallback(
        (newKey: string) => {
            const trimmed = newKey.trim()
            if (trimmed && trimmed !== k) {
                handleRename(path, trimmed)
            }
        },
        [handleRename, path, k],
    )

    let input: ReactNode = (
        <AutosizeTextarea
            rows={3}
            variant="ghost"
            value={localValue === null || localValue === undefined ? "" : String(localValue)}
            onChange={(e) => emit(e.target.value)}
        />
    )

    if (typeof value === "number")
        input = (
            <InputNumber
                className="w-full [&_input]:text-right"
                value={typeof localValue === "number" ? localValue : null}
                onChange={(next) => emit(next)}
            />
        )
    else if (typeof value === "boolean")
        input = <Switch checked={Boolean(localValue)} onCheckedChange={(next) => emit(next)} />
    else if (typeof value === "string")
        input = (
            <Input
                variant="ghost"
                value={typeof localValue === "string" ? localValue : ""}
                onChange={(e) => emit(e.target.value)}
            />
        )

    return (
        <TreeRow depth={depth} className={clsx("primitive", className)}>
            {typeof k === "number" ? (
                <span className="text-xs font-semibold leading-5 mr-1">{k}</span>
            ) : (
                <EditableText
                    value={k}
                    onChange={handleRenameKey}
                    monospace={false}
                    className="font-semibold leading-5 mr-1"
                />
            )}
            <div className="flex-1 leading-5">{input}</div>
        </TreeRow>
    )
}

export default PrimitiveNodeComponent
