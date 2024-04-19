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
}

const getTextContent = (element: React.ReactNode): string => {
    if (typeof element === "string") {
        return element
    } else if (React.isValidElement(element) && element.props.children) {
        return React.Children.toArray(element.props.children).reduce<string>(
            (acc, child) => acc + getTextContent(child),
            "",
        )
    }
    return ""
}

const filterOption = (input: string, option?: {label: React.ReactNode; value: string}) =>
    getTextContent(option?.label).toLowerCase().includes(input.toLowerCase())

export const GroupedSelect: React.FC<GroupedSelectProps> = ({
    choices,
    defaultValue,
    handleChange,
}) => {
    const classes = useStyles()

    const options = Object.entries(choices).map(([groupLabel, groupChoices]) => ({
        label: (
            <div className={classes.option}>
                {iconMap[groupLabel] ? React.createElement(iconMap[groupLabel]) : null}
                {groupLabel}
            </div>
        ),
        options: groupChoices.map((choice) => ({
            label: (
                <div className={classes.option}>
                    {iconMap[groupLabel] ? React.createElement(iconMap[groupLabel]) : null}
                    {choice}
                </div>
            ),
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
