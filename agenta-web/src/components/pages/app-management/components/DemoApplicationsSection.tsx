import {JSSTheme} from "@/lib/Types"
import {Button, Card, Flex, Space, Typography} from "antd"
import React from "react"
import Image from "next/image"
import {createUseStyles} from "react-jss"
import RagDemoImage from "@/media/rag-demo-app.jpg"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    demoAppCard: {
        width: 400,
        "& .ant-card-body": {
            padding: theme.paddingSM,
            "& span.ant-typography": {
                textOverflow: "ellipsis",
                fontSize: theme.fontSizeLG,
                fontWeight: theme.fontWeightMedium,
                lineHeight: theme.lineHeightLG,
                color: "inherit",
            },
            "& div.ant-typography": {
                fontSize: theme.fontSizeLG,
                lineHeight: theme.lineHeightLG,
                color: theme.colorTextSecondary,
            },
        },
    },
}))

const {Text, Title, Paragraph} = Typography

const DemoApplicationsSection = () => {
    const classes = useStyles()

    return (
        <div className="my-10 flex flex-col gap-4">
            <Space direction="vertical" size={8}>
                <Title level={2}>Explore demo applications</Title>
                <Text>
                    See Agenta in action by exploring fully build prompts, evaluations,
                    observability and traces. Learn how to set your application by watching
                    tutorials.
                </Text>
            </Space>

            <div>
                <Card
                    className={classes.demoAppCard}
                    cover={
                        <Image
                            src={RagDemoImage}
                            alt="rag_demo_application_image"
                            height={200}
                            priority
                        />
                    }
                >
                    <Space direction="vertical" size={24}>
                        <Space direction="vertical">
                            <Text>RAG Q&A with Wikipedia</Text>
                            <Paragraph>
                                Use RAG to answer questions by fetching relevant information from
                                wikipedia
                            </Paragraph>
                        </Space>
                        <Flex gap={8}>
                            <Button className="flex-[0.3]">Read Tutorial</Button>
                            <Button className="flex-[0.7]">View Demo</Button>
                        </Flex>
                    </Space>
                </Card>
            </div>
        </div>
    )
}

export default DemoApplicationsSection
