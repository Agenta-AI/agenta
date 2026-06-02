import {Button, Card, Flex, Space, Typography} from "antd"
import Image from "next/image"

import {useOrgData} from "@/oss/state/org"
import {useProjectData} from "@/oss/state/project"

const demoAppCardClass =
    "w-[400px] [&_.ant-card-body]:p-3 [&_.ant-card-body_span.ant-typography]:text-ellipsis [&_.ant-card-body_span.ant-typography]:text-sm [&_.ant-card-body_span.ant-typography]:font-medium [&_.ant-card-body_span.ant-typography]:leading-[1.5714285714285714] [&_.ant-card-body_span.ant-typography]:text-[inherit] [&_.ant-card-body_div.ant-typography]:text-sm [&_.ant-card-body_div.ant-typography]:leading-[1.5714285714285714] [&_.ant-card-body_div.ant-typography]:text-colorTextSecondary"

const {Text, Title, Paragraph} = Typography

const DemoApplicationsSection = () => {
    const {projects} = useProjectData()
    const {changeSelectedOrg} = useOrgData()

    const handleViewDemoSwitch = () => {
        const project = projects.find((p) => !!p.is_demo)
        if (project && project.organization_id) {
            changeSelectedOrg(project.organization_id)
        }
    }

    return (
        <div className="my-10 flex flex-col gap-4">
            <Space orientation="vertical" size={8}>
                <Title level={2}>Explore demo applications</Title>
                <Text>
                    See Agenta in action by exploring fully build prompts, evaluations,
                    observability and traces. Learn how to set your application by watching
                    tutorials.
                </Text>
            </Space>

            <div>
                <Card
                    className={demoAppCardClass}
                    cover={
                        <Image
                            src={"/assets/rag-demo-app.webp"}
                            alt="rag_demo_application_image"
                            height={200}
                            width={200}
                            priority
                        />
                    }
                >
                    <Space orientation="vertical" size={24}>
                        <Space orientation="vertical">
                            <Text>RAG Q&A with Wikipedia</Text>
                            <Paragraph>
                                Use RAG to answer questions by fetching relevant information from
                                wikipedia
                            </Paragraph>
                        </Space>
                        <Flex gap={8}>
                            <Button
                                className="flex-1"
                                // className="flex-[0.3]"
                                target="_blank"
                                href="https://agenta.ai/docs/tutorials/cookbooks/RAG-QA-docs"
                            >
                                Read Tutorial
                            </Button>
                            <Button className="flex-[0.7] hidden" onClick={handleViewDemoSwitch}>
                                View Demo
                            </Button>
                        </Flex>
                    </Space>
                </Card>
            </div>
        </div>
    )
}

export default DemoApplicationsSection
