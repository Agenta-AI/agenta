// @ts-nocheck
import {type ReactNode, type FC} from "react"

import {Select} from "antd"
import {createUseStyles} from "react-jss"

import LLMIcons from "@/oss/components/LLMIcons"

const useStyles = createUseStyles({
    select: {
        width: "100%",
    },
    option: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
})

interface GroupedSelectProps {
    choices: Record<string, string[]>
    defaultValue: string
    handleChange: (value: string) => void
}

const filterOption = (input: string, option?: {label: ReactNode; value: string}) =>
    (option?.value ?? "").toLowerCase().includes(input.toLowerCase())

export const ModelName: FC<{label: string; value: string}> = ({label, value}) => {
    const classes = useStyles()

    const Icon = LLMIcons[value.toLowerCase()]
    return (
        <div className={classes.option}>
            {Icon ? <Icon className="w-4 h-4" /> : null}
            {label}
        </div>
    )
}

export const GroupedSelect: FC<GroupedSelectProps> = ({choices, defaultValue, handleChange}) => {
    const classes = useStyles()

    const options = Object.entries(choices).map(([groupLabel, groupChoices]) => ({
        label: <ModelName label={groupLabel} value={groupLabel} />,
        options: groupChoices.map((choice) => ({
            label: <ModelName label={choice} value={groupLabel} />,
            value: choice,
        })),
    }))
    return (
        <Select
            showSearch
            defaultValue={defaultValue}
            className={classes.select}
            onChange={handleChange}
            filterOption={filterOption}
            options={options as any}
        />
    )
}
