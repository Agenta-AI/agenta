import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {Space, Typography} from "antd"
import React from "react"
import AccordionTreePanel from "../../../../components/AccordionTreePanel"
import {transformDataInputs} from "../../utils"
import {_AgentaRootsResponse} from "@/oss/services/observability/types"
import {useStyles} from "../../assets/styles"

const OverviewTabItem = ({activeTrace}: {activeTrace: _AgentaRootsResponse}) => {
    const classes = useStyles()

    return (
        <Space direction="vertical" size={24} className="w-full">
            {activeTrace?.meta && activeTrace?.meta.request && (
                <Space direction="vertical">
                    <Typography.Text className={classes.subTitle}>Meta Data</Typography.Text>
                    <Space style={{flexWrap: "wrap"}}>
                        {Object.entries(activeTrace?.meta.request).map(([key, value], index) => (
                            <ResultTag key={index} value1={key} value2={getStringOrJson(value)} />
                        ))}
                    </Space>
                </Space>
            )}

            {activeTrace?.data && activeTrace?.data?.inputs ? (
                <Space direction="vertical" className="w-full" size={24}>
                    {activeTrace?.node?.type !== "chat" ? (
                        <AccordionTreePanel
                            label={"inputs"}
                            value={activeTrace?.data.inputs}
                            enableFormatSwitcher
                        />
                    ) : (
                        Object.entries(transformDataInputs(activeTrace?.data?.inputs)).map(
                            ([key, values]) => {
                                if (key === "prompt") {
                                    return Array.isArray(values)
                                        ? values.map((param, index) => (
                                              <AccordionTreePanel
                                                  key={index}
                                                  label={param.role}
                                                  value={param.content}
                                                  enableFormatSwitcher={param.role === "tool"}
                                              />
                                          ))
                                        : null
                                } else {
                                    return Array.isArray(values) && values.length > 0 ? (
                                        <AccordionTreePanel
                                            key={key}
                                            label="tools"
                                            value={values as any[]}
                                            enableFormatSwitcher
                                        />
                                    ) : null
                                }
                            },
                        )
                    )}
                </Space>
            ) : null}

            {activeTrace?.data && activeTrace?.data?.outputs ? (
                <Space direction="vertical" className="w-full" size={24}>
                    {activeTrace?.node?.type !== "chat" ? (
                        <AccordionTreePanel
                            label={"outputs"}
                            value={activeTrace?.data.outputs}
                            enableFormatSwitcher
                        />
                    ) : (
                        Object.values(activeTrace?.data.outputs).map((item) =>
                            Array.isArray(item)
                                ? item.map((param, index) =>
                                      !!param.content && !Array.isArray(param.tool_calls) ? (
                                          <AccordionTreePanel
                                              key={index}
                                              label={"assistant"}
                                              value={param.content}
                                              bgColor="#E6FFFB"
                                          />
                                      ) : (
                                          <AccordionTreePanel
                                              key={index}
                                              label={"assistant"}
                                              value={param}
                                              enableFormatSwitcher
                                          />
                                      ),
                                  )
                                : null,
                        )
                    )}
                </Space>
            ) : null}

            {activeTrace?.data && activeTrace?.data?.internals && (
                <Space direction="vertical" className="w-full" size={24}>
                    {activeTrace?.node?.type !== "chat" && (
                        <AccordionTreePanel
                            label={"internals"}
                            value={activeTrace?.data.internals}
                            enableFormatSwitcher
                        />
                    )}
                </Space>
            )}

            {activeTrace?.exception && (
                <Space direction="vertical" className="w-full" size={24}>
                    <AccordionTreePanel
                        label={"Exception"}
                        value={activeTrace?.exception}
                        enableFormatSwitcher
                        bgColor="#FBE7E7"
                    />
                </Space>
            )}
        </Space>
    )
}

export default OverviewTabItem
