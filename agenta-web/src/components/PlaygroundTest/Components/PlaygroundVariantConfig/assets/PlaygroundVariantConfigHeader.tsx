import clsx from "clsx"
import {Typography, Tag, Button} from "antd"
import {type StateVariant, type InitialStateType} from "../../../state/types"
import usePlaygroundVariant from "@/components/PlaygroundTest/hooks/usePlaygroundVariant"
import isEqual from "lodash/isEqual"
import { useCallback } from "react"
import { PlaygroundStateData } from "@/components/PlaygroundTest/hooks/usePlaygroundState/types"

const PlaygroundVariantConfigHeader = ({variantId}: {variantId: StateVariant["variantId"]}) => {
    const {variant, isDirty, deleteVariant, saveVariant} = usePlaygroundVariant({
        variantId,
        compare: useCallback(
            (a?: PlaygroundStateData, b?: PlaygroundStateData): boolean => {
                if (!a || !b) return false
                if (!isEqual(a, b)) {
                    return a.dirtyStates?.get(variantId) === b.dirtyStates?.get(variantId)
                }
                return true
            },
            [variantId],
        ),
    })

    console.log('render - PlaygroundVariantConfigHeader !!!!!!!!!!!')

    return !variant ? (
        <div>
            variant not found
        </div>
    ) : (
        <div
            className={clsx([
                "w-full h-10 px-2.5",
                "bg-[#f5f7fa]",
                "flex items-center justify-between",
                "sticky top-0 z-[1]",
            ])}
        >
            <div className="flex items-center gap-2">
                <Typography.Text className="text-[14px] leading-[22px] font-[500]">
                    {variant.variantName}
                </Typography.Text>
                <Tag color="default" bordered={false} className="bg-[rgba(5,23,41,0.06)]">
                    {`v${variant.revision}`}
                </Tag>
            </div>
            <div className="flex items-center gap-2">
                {
                    isDirty ? (
                        <Button type="primary" size="small" onClick={saveVariant}>
                            Save
                        </Button>
                    ) : null
                }
                <Button type="default" color="primary" size="small" onClick={deleteVariant}>
                    Delete
                </Button>
            </div>
        </div>
    )
}

export default PlaygroundVariantConfigHeader
