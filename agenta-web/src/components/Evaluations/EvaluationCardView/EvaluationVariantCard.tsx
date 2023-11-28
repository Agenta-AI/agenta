import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {Variant} from "@/lib/Types"
import {Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"
import {VARIANT_COLORS} from "."

type StyleProps = {
    themeMode: "dark" | "light"
}

const useStyles = createUseStyles({
    root: ({themeMode}: StyleProps) => ({
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.75rem",
        border: `1px solid ${themeMode === "dark" ? "#424242" : "#d9d9d9"}`,
        padding: "0.75rem",
        paddingTop: "1.25rem",
        borderRadius: 6,
        "& img": {
            maxHeight: 300,
            width: "100%",
            objectFit: "contain",
            borderRadius: "inherit",
        },
        position: "relative",
    }),
    title: {
        fontSize: 20,
        textAlign: "center",
    },
    output: {
        whiteSpace: "pre-line",
        position: "relative",
        maxHeight: 300,
        overflow: "auto",
    },
    variantType: {
        position: "absolute",
        top: 10,
        left: 10,
        borderRadius: "50%",
        border: `1.5px solid`,
        width: 32,
        aspectRatio: "1/1",
        display: "grid",
        placeItems: "center",

        "& .ant-typography": {
            fontSize: 18,
        },
    },
})

type Props = {
    variant: Variant
    outputText?: string
    outputImg?: string
    index?: number
    showVariantName?: boolean
}

const EvaluationVariantCard: React.FC<Props> = ({
    variant,
    outputText,
    outputImg,
    index = 0,
    showVariantName = true,
}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)
    const color = VARIANT_COLORS[index]

    return (
        <div className={classes.root}>
            {showVariantName && (
                <>
                    {" "}
                    <div className={classes.variantType} style={{borderColor: color}}>
                        <Typography.Text style={{color}} strong>
                            {String.fromCharCode(65 + index)}
                        </Typography.Text>
                    </div>
                    <Typography.Text className={classes.title}>
                        {variant.variantName}
                    </Typography.Text>{" "}
                </>
            )}
            {outputImg && <img alt="output" src={outputImg} />}
            <Typography.Text className={classes.output} type={outputText ? undefined : "secondary"}>
                {outputText || <em>Click the "Run" icon to get variant output</em>}
            </Typography.Text>
        </div>
    )
}

export default EvaluationVariantCard
