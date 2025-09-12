import {memo, useMemo} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import Version from "@/oss/components/Playground/assets/Version"
import {revisionListAtom} from "@/oss/components/Playground/state/atoms"

import {useStyles} from "../styles"

import {GenerationComparisonOutputHeaderProps} from "./types"

const GenerationComparisonOutputHeader: React.FC<GenerationComparisonOutputHeaderProps> = ({
    className,
    variantId,
}) => {
    // Use atom-based state management
    const revisions = useAtomValue(revisionListAtom)

    const {variantName, revision} = useMemo(() => {
        const variant = (revisions || []).find((rev) => rev.id === variantId)
        return {
            variantName: variant?.variantName,
            revision: variant?.revision,
        }
    }, [revisions, variantId])
    const classes = useStyles()

    return (
        <div className={clsx(classes.title, className)}>
            <Typography>{variantName}</Typography>
            <Version revision={revision as number} />
        </div>
    )
}

export default memo(GenerationComparisonOutputHeader)
