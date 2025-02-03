import React from "react"
import {createUseStyles} from "react-jss"
import {Select} from "antd"

import {
    IconType,
    OpenAI,
    Mistral,
    Cohere,
    Anthropic,
    Perplexity,
    Together,
    OpenRouter,
    Fireworks,
    Groq,
    Gemini,
} from "@lobehub/icons"

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

interface IconMap {
    [key: string]: IconType
}

interface GroupedSelectProps {
    choices: {[group: string]: string[]}
    defaultValue: string
    handleChange: (value: string) => void
}

const iconMap: {[key: string]: React.ComponentType<any>} = {
    "Open AI": OpenAI,
    "Mistral AI": Mistral.Color,
    Cohere: Cohere.Color,
    Anthropic: Anthropic,
    "Perplexity AI": Perplexity.Color,
    "Together AI": Together.Color,
    OpenRouter: OpenRouter,
    Groq: Groq,
    Gemini: Gemini.Color,
}

const filterOption = (input: string, option?: {label: React.ReactNode; value: string}) =>
    (option?.value ?? "").toLowerCase().includes(input.toLowerCase())

export const ModelName: React.FC<{label: string; value: string}> = ({label, value}) => {
    const classes = useStyles()

    return (
        <div className={classes.option}>
            {iconMap[value] ? React.createElement(iconMap[value]) : null}
            {label}
        </div>
    )
}

export const GroupedSelect: React.FC<GroupedSelectProps> = ({
    choices,
    defaultValue,
    handleChange,
}) => {
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
