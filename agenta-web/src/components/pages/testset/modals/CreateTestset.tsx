import React from "react"
import {JSSTheme} from "@/lib/Types"
import {Typography} from "antd"
import {createUseStyles} from "react-jss"

const {Text, Paragraph} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    headerText: {
        lineHeight: theme.lineHeightLG,
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightStrong,
    },
    appTemplate: {
        gap: 16,
        display: "flex",
        flexDirection: "column",
    },
    template: {
        border: "1px solid",
        borderColor: theme.colorBorderSecondary,
        borderRadius: theme.borderRadiusLG,
        paddingTop: theme.paddingSM,
        paddingBottom: theme.paddingSM,
        paddingInline: theme.padding,
        boxShadow:
            "0px 2px 4px 0px #00000005, 0px 1px 6px -1px #00000005, 0px 1px 2px 0px #00000008",
        gap: 2,
        cursor: "pointer",
        "& > span": {
            fontSize: theme.fontSizeLG,
            lineHeight: theme.lineHeightLG,
            fontWeight: theme.fontWeightMedium,
        },
        "& > div": {
            marginBottom: 0,
        },
    },
}))

type Props = {setCurrent: React.Dispatch<React.SetStateAction<number>>}

const CreateTestset: React.FC<Props> = ({setCurrent}) => {
    const classes = useStyles()
    return (
        <section className={classes.appTemplate}>
            <Text className={classes.headerText}>Create new test set</Text>
            <div className="flex flex-col gap-6">
                <div
                    className={classes.template}
                    onClick={() => setCurrent(1)}
                    data-cy="create-testset-from-scratch"
                >
                    <Text>Create from scratch</Text>
                    <Paragraph>Create a new test set directly from the webUI</Paragraph>
                </div>
                <div
                    className={classes.template}
                    onClick={() => setCurrent(2)}
                    data-cy="upload-testset"
                >
                    <Text>Upload a test set</Text>
                    <Paragraph>Upload your test set as CSV or JSON</Paragraph>
                </div>
                <div className={classes.template} onClick={() => setCurrent(3)}>
                    <Text>Create with API</Text>
                    <Paragraph>
                        Create a test set programmatically using our API endpoints
                    </Paragraph>
                </div>
            </div>
        </section>
    )
}

export default CreateTestset
