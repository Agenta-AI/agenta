import {Segmented} from "antd"
import clsx from "clsx"

import {ALL_TEMPLATES_CATEGORY} from "../../assets/templates"

interface TemplateCategoryChipsProps {
    categories: string[]
    active: string
    onChange: (category: string) => void
    className?: string
}

/** Category filter, styled as the same Segmented control the hero composer uses. */
const TemplateCategoryChips = ({
    categories,
    active,
    onChange,
    className,
}: TemplateCategoryChipsProps) => {
    return (
        <Segmented
            value={active}
            onChange={(value) => onChange(value as string)}
            className={clsx("self-start", className)}
            options={[ALL_TEMPLATES_CATEGORY, ...categories]}
        />
    )
}

export default TemplateCategoryChips
