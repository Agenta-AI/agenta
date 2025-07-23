import {Flex, Space, Typography} from "antd"

import CopyButton from "@/oss/components/CopyButton/CopyButton"

import {useStyles} from "../assets/styles"

const {Text} = Typography

export const TracingCodeComponent = ({
    command: {title, code},
    index,
}: {
    command: {title: string; code: string}
    index: number
}) => {
    const classes = useStyles()

    return (
        <div className="flex flex-col gap-2">
            <Flex align="center" justify="space-between">
                <Space>
                    <Text>{index + 1}.</Text>
                    <Text>{title}</Text>
                </Space>
                <CopyButton buttonText={""} icon text={code} />
            </Flex>
            <div className={classes.command}>
                <pre className="m-0">{code}</pre>
            </div>
        </div>
    )
}
