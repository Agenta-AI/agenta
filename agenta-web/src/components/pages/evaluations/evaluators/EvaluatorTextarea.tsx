import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"
import React, {useRef} from "react"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    editableText: {
        borderRadius: theme.borderRadius,
        border: `1px solid ${theme.colorBorder}`,
        padding: theme.paddingSM,
        whiteSpace: "pre-wrap",
    },
    editableSpan: {
        color: "#ce9c03",
        backgroundColor: theme.isDark ? "#393322" : "#fef5d1",
    },
}))

interface EvaluatorTextareaProps {
    value: string
    onChange: (value: string) => void
}

const EvaluatorTextarea = ({value, onChange}: EvaluatorTextareaProps) => {
    const parts = value.split(/({.*?})/).filter(Boolean)
    const classes = useStyles()
    const editableRef = useRef<HTMLDivElement>(null)

    const handleChange = () => {
        if (editableRef.current) {
            onChange(editableRef.current.textContent || "")
        }
    }

    return (
        <>
            <div
                className={classes.editableText}
                contentEditable
                ref={editableRef}
                onInput={handleChange}
            >
                {parts.map((part, index) =>
                    part.startsWith("{") && part.endsWith("}") ? (
                        <span key={index} className={classes.editableSpan}>
                            {part}
                        </span>
                    ) : (
                        part
                    ),
                )}
            </div>
        </>
    )
}

export default EvaluatorTextarea
