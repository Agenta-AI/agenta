import {Button} from "@agenta/primitive-ui/components/button"
import {Card, CardContent} from "@agenta/primitive-ui/components/card"
import {Flex, Space} from "antd"
import Image from "next/image"

import {useOrgData} from "@/oss/state/org"
import {useProjectData} from "@/oss/state/project"

const demoAppCardClass = "w-[400px]"

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
                <h2 className="text-xl font-semibold leading-tight">Explore demo applications</h2>
                <span>
                    See Agenta in action by exploring fully build prompts, evaluations,
                    observability and traces. Learn how to set your application by watching
                    tutorials.
                </span>
            </Space>

            <div>
                <Card className={demoAppCardClass}>
                    <Image
                        src={"/assets/rag-demo-app.webp"}
                        alt="rag_demo_application_image"
                        height={200}
                        width={200}
                        priority
                    />
                    <CardContent className="p-3">
                        <Space orientation="vertical" size={24}>
                            <Space orientation="vertical">
                                <span className="text-ellipsis text-sm font-medium leading-[1.5714285714285714]">
                                    RAG Q&A with Wikipedia
                                </span>
                                <p className="text-sm leading-[1.5714285714285714] text-colorTextSecondary">
                                    Use RAG to answer questions by fetching relevant information
                                    from wikipedia
                                </p>
                            </Space>
                            <Flex gap={8}>
                                <Button
                                    className="flex-1"
                                    variant="outline"
                                    render={
                                        <a
                                            href="https://agenta.ai/docs/tutorials/cookbooks/RAG-QA-docs"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        />
                                    }
                                >
                                    Read Tutorial
                                </Button>
                                <Button
                                    className="flex-[0.7] hidden"
                                    onClick={handleViewDemoSwitch}
                                    variant="outline"
                                >
                                    View Demo
                                </Button>
                            </Flex>
                        </Space>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

export default DemoApplicationsSection
