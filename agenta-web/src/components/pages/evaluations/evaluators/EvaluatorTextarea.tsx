import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"
import {Input} from "antd"

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

    const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(event.target.value)
    }

    return (
        <>
            <div className={classes.editableText}>
                {parts.map((part, index) => {
                    return (
                        <>
                            {part.startsWith("{") && part.endsWith("}") ? (
                                <span key={index} className={classes.editableSpan}>
                                    {part}
                                </span>
                            ) : (
                                part
                            )}
                        </>
                    )
                })}
            </div>
            <Input.TextArea value={parts.join("")} rows={10} onChange={handleChange} />
        </>
    )
}

export default EvaluatorTextarea
