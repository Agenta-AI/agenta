import React, {useState} from "react"
import {JSSTheme} from "@/lib/Types"
import {ArrowLeft, FileCsv, Trash} from "@phosphor-icons/react"
import {Button, Collapse, Input, Radio, Typography} from "antd"
import {createUseStyles} from "react-jss"
import {UploadOutlined} from "@ant-design/icons"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    headerText: {
        lineHeight: theme.lineHeightLG,
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightStrong,
    },
    label: {
        fontWeight: theme.fontWeightMedium,
    },
    uploadContainer: {
        padding: theme.paddingXS,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        border: "1px solid",
        borderColor: theme.colorBorder,
        borderRadius: theme.borderRadiusLG,
    },
    subText: {
        color: theme.colorTextSecondary,
    },
}))

type Props = {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    onCancel: () => void
}

const UploadTestset: React.FC<Props> = ({setCurrent, onCancel}) => {
    const classes = useStyles()
    const [uploadType, setUploadType] = useState<"csv" | "json">("csv")

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2">
                <Button
                    icon={<ArrowLeft size={14} className="mt-0.5" />}
                    className="flex items-center justify-center"
                    onClick={() => setCurrent(0)}
                />

                <Typography.Text className={classes.headerText}>Upload a test set</Typography.Text>
            </div>

            <div className="flex flex-col gap-6">
                <Typography.Text>Create a new test set directly from the webUI</Typography.Text>

                <div className="grid gap-2">
                    <Typography.Text className={classes.label}>Select type</Typography.Text>
                    <Radio.Group value={uploadType} onChange={(e) => setUploadType(e.target.value)}>
                        <Radio value="csv">CSV</Radio>
                        <Radio value="json">JSON</Radio>
                    </Radio.Group>
                </div>

                <div className="grid gap-1">
                    <Typography.Text className={classes.label}>Name of testset</Typography.Text>
                    <Input placeholder="Enter a name" />
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <Typography.Text className={classes.label}>
                            Upload CSV or JSON
                        </Typography.Text>
                        <Button icon={<UploadOutlined size={16} />}>Upload</Button>
                    </div>

                    <div className={classes.uploadContainer}>
                        <div className="flex items-center gap-2">
                            <FileCsv size={32} />
                            <Typography.Text>File-name</Typography.Text>
                        </div>

                        <Trash size={22} className={classes.subText} />
                    </div>
                </div>

                <div>
                    <Collapse
                        defaultActiveKey={["1"]}
                        expandIconPosition="end"
                        items={[
                            {
                                key: "1",
                                label: "Instructions",
                                children: (
                                    <div className="flex flex-col items-start gap-4">
                                        {uploadType === "csv" ? (
                                            <>
                                                {" "}
                                                <Typography.Text>
                                                    The test set should be in CSV format with the
                                                    following requirements:
                                                </Typography.Text>
                                                <div className="flex flex-col">
                                                    <Typography.Text>
                                                        1. Comma separated values
                                                    </Typography.Text>
                                                    <Typography.Text>
                                                        2. The first row should contain the headers
                                                    </Typography.Text>
                                                </div>
                                                <Typography.Paragraph>
                                                    Here is an example of a valid CSV file: <br />
                                                    recipe_name,correct_answer <br />
                                                    ChickenParmesan,Chicken <br /> "a, special,
                                                    recipe",Beef
                                                </Typography.Paragraph>
                                            </>
                                        ) : (
                                            <>
                                                <Typography.Text>
                                                    The test set should be in JSON format with the
                                                    following requirements:
                                                </Typography.Text>

                                                <div className="flex flex-col">
                                                    <Typography.Text>
                                                        1. A json file with an array of rows
                                                    </Typography.Text>
                                                    <Typography.Text>
                                                        2. Each row in the array should be an object
                                                    </Typography.Text>
                                                    <Typography.Text>
                                                        of column header name as key and row data as
                                                        value.
                                                    </Typography.Text>
                                                </div>

                                                <Typography.Paragraph>
                                                    Here is an example of a valid JSON file: <br />
                                                    {`[{ "recipe_name": "Chicken Parmesan","correct_answer": "Chicken" },
{ "recipe_name": "a, special, recipe","correct_answer": "Beef" }]`}
                                                </Typography.Paragraph>
                                            </>
                                        )}

                                        <Button>Read the docs</Button>
                                    </div>
                                ),
                            },
                        ]}
                    />
                </div>
            </div>

            <div className="flex justify-end gap-2 mt-3">
                <Button onClick={onCancel}>Cancel</Button>
                <Button type="primary">Create test set</Button>
            </div>
        </section>
    )
}

export default UploadTestset
