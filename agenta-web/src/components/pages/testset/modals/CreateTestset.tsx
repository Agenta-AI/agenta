import {isDemo} from "@/lib/helpers/utils"
import {JSSTheme} from "@/lib/Types"
import {Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

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
            <Typography.Text className={classes.headerText}>Create new test set</Typography.Text>
            <div className="flex flex-col gap-6">
                <div
                    className={classes.template}
                    onClick={() => setCurrent(1)}
                    data-cy="create-testset-from-scratch"
                >
                    <Typography.Text>Create from scratch</Typography.Text>
                    <Typography.Paragraph>
                        Create a new test set directly from the webUI
                    </Typography.Paragraph>
                </div>
                <div
                    className={classes.template}
                    onClick={() => setCurrent(2)}
                    data-cy="upload-testset"
                >
                    <Typography.Text>Upload a test set</Typography.Text>
                    <Typography.Paragraph>Upload your test set as CSV or JSON</Typography.Paragraph>
                </div>
                <div className={classes.template} onClick={() => setCurrent(3)}>
                    <Typography.Text>Create with API</Typography.Text>
                    <Typography.Paragraph>
                        Create a test set programmatically using our API endpoints
                    </Typography.Paragraph>
                </div>
                {!isDemo() && (
                    <div className={classes.template} onClick={() => setCurrent(4)}>
                        <Typography.Text>Import from endpoint</Typography.Text>
                        <Typography.Paragraph>
                            Import test set using your own endpoint
                        </Typography.Paragraph>
                    </div>
                )}
            </div>
        </section>
    )
}

export default CreateTestset
