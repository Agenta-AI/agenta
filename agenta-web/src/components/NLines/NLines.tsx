import {Space, Typography} from "antd"
import React, {useMemo, useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    text: ({lines}: {lines: number}) => ({
        display: "-webkit-box",
        "-webkit-line-clamp": lines,
        "-webkit-box-orient": "vertical",
    }),
})

interface Props {
    lines?: number
    allowReadMore?: boolean
    children: React.ReactNode
}

const NLines: React.FC<Props> = ({lines = 8, allowReadMore = false, children}) => {
    const [collapsed, setCollapsed] = useState(true)
    const classes = useStyles({lines})
    const [ref, setRef] = useState<HTMLSpanElement>()

    const actualLines = useMemo(() => {
        if (ref) {
            const lineHeight = parseInt(getComputedStyle(ref).lineHeight)
            return ref.offsetHeight / lineHeight
        }
        return lines
    }, [collapsed, ref])

    return (
        <Space direction="vertical" size={4}>
            <Typography.Text
                ref={(elem) => setRef(elem!)}
                className={`overflow-hidden text-ellipsis ${collapsed ? classes.text : ""} whitespace-pre-line`}
            >
                {children}
            </Typography.Text>
            {allowReadMore && actualLines >= lines && (
                <Typography.Link
                    onClick={(e) => {
                        setCollapsed(!collapsed)
                        e.stopPropagation()
                    }}
                >
                    {collapsed ? "Read more" : "Read less"}
                </Typography.Link>
            )}
        </Space>
    )
}

export default NLines
