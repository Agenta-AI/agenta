import {useMemo} from "react"
import {Collapse} from "antd"
import Version from "../../assets/Version"
import {PlaygroundDeploymentConfigProps} from "./types"

const PlaygroundDeploymentConfig: React.FC<PlaygroundDeploymentConfigProps> = ({...props}) => {
    const items = useMemo(
        () => [
            {
                key: "1",
                classNames: {
                    header: "[&.ant-collapse-header]:!px-2.5",
                },
                label: "Deployment",
                children: (
                    <div className="flex items-center gap-2">
                        {[1, 2, 3].map((item) => (
                            <Version
                                type="deployment"
                                revision={item}
                                deploymentName="production"
                            />
                        ))}
                    </div>
                ),
            },
        ],
        [],
    )
    return <Collapse ghost defaultActiveKey={["1"]} bordered={false} items={items} {...props} />
}

export default PlaygroundDeploymentConfig
