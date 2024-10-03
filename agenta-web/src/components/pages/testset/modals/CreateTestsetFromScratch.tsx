import React from "react"
import {JSSTheme} from "@/lib/Types"
import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Input, Typography} from "antd"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    headerText: {
        lineHeight: theme.lineHeightLG,
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightStrong,
    },
    label: {
        fontWeight: theme.fontWeightMedium,
    },
}))

type Props = {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    onCancel: () => void
}

const CreateTestsetFromScratch: React.FC<Props> = ({setCurrent, onCancel}) => {
    const classes = useStyles()
    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2 mb-1">
                <Button
                    icon={<ArrowLeft size={14} className="mt-0.5" />}
                    className="flex items-center justify-center"
                    onClick={() => setCurrent(0)}
                />

                <Typography.Text className={classes.headerText}>
                    Create from scratch
                </Typography.Text>
            </div>

            <Typography.Text>Create a new test set directly from the webUI</Typography.Text>

            <div className="grid gap-1">
                <Typography.Text className={classes.label}>Name of testset</Typography.Text>
                <Input placeholder="Enter a name" />
            </div>

            <div className="flex justify-end gap-2 mt-3">
                <Button onClick={onCancel}>Cancel</Button>
                <Button type="primary">Create test set</Button>
            </div>
        </section>
    )
}

export default CreateTestsetFromScratch
