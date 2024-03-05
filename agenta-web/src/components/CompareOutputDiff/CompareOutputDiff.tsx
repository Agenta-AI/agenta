import React from "react"
import {diffWords} from "diff"
import {useAppTheme} from "../Layout/ThemeContextProvider"

interface CompareOutputDiffProps {
    variantOutput: any
    expectedOutput: any
}

const CompareOutputDiff = ({variantOutput, expectedOutput}: CompareOutputDiffProps) => {
    const {appTheme} = useAppTheme()
    const results = diffWords(variantOutput, expectedOutput)

    const display = results.map((part, index) => {
        if (part.removed) {
            return (
                <span
                    key={index}
                    style={{
                        backgroundColor: "#ccffd8",
                        color: "#000",
                    }}
                >
                    {part.value}
                </span>
            )
        } else if (!part.added) {
            return <span key={index}>{part.value}</span>
        } else if (part.added) {
            return (
                <>
                    {" "}
                    <span
                        key={index}
                        style={{
                            backgroundColor: "#ff818266",
                            textDecoration: "line-through",
                            color: appTheme === "dark" ? "#f1f5f8" : "#000",
                        }}
                    >
                        {part.value}
                    </span>
                </>
            )
        }
        return null
    })

    return <span>{display}</span>
}

export default CompareOutputDiff
