import AnnotationConfiguration from "@/components/pages/annotations/AnnotationConfiguration/AnnotationConfiguration"
import AnnotationResults from "@/components/pages/annotations/AnnotationResults/AnnotationResults"
import {useQueryParam} from "@/hooks/useQuery"
import {SlidersOutlined, UnorderedListOutlined} from "@ant-design/icons"
import {Tabs} from "antd"

export default function Evaluation() {
    const [tab, setTab] = useQueryParam("tab", "results")

    return (
        <Tabs
            destroyInactiveTabPane
            activeKey={tab}
            items={[
                {
                    key: "results",
                    label: "Results",
                    icon: <UnorderedListOutlined />,
                    children: <AnnotationResults />,
                },
                {
                    key: "configuration",
                    label: "Configuration",
                    icon: <SlidersOutlined />,
                    children: <AnnotationConfiguration />,
                },
            ]}
            onChange={setTab}
        />
    )
}
