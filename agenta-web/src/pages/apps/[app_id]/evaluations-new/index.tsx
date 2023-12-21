import EvaluationResults from "@/components/pages/evaluations/evaluationResults/EvaluationResults"
import Evaluators from "@/components/pages/evaluations/evaluators/Evaluators"
import {useQueryParam} from "@/hooks/useQuery"
import {SlidersOutlined, UnorderedListOutlined} from "@ant-design/icons"
import {Tabs} from "antd"
import React from "react"

interface Props {}

const Evaluations: React.FC<Props> = () => {
    const [tab, setTab] = useQueryParam("tab", "results")

    return (
        <div>
            <Tabs
                defaultActiveKey={tab}
                items={[
                    {
                        key: "results",
                        label: "Results",
                        icon: <UnorderedListOutlined />,
                        children: <EvaluationResults />,
                    },
                    {
                        key: "evaluators",
                        label: "Evaluators",
                        icon: <SlidersOutlined />,
                        children: <Evaluators />,
                    },
                ]}
                onChange={setTab}
            />
        </div>
    )
}

export default Evaluations
