import React from "react"

import {Space, Typography} from "antd"

import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {_AgentaRootsResponse} from "@/oss/services/observability/types"

import AccordionTreePanel from "../../../../components/AccordionTreePanel"
import {useStyles} from "../../assets/styles"
import {transformDataInputs} from "../../utils"

const OverviewTabItem = ({activeTrace}: {activeTrace: _AgentaRootsResponse}) => {
    const classes = useStyles()

    return (
        <Space direction="vertical" size={24} className="w-full">
            {activeTrace?.meta && activeTrace?.meta.request && (
                <Space style={{flexWrap: "wrap"}}>
                    {Object.entries(activeTrace?.meta.request)
                        .filter(([key]) => [
                            'model',
                            'temperature',
                            'base_url',
                            'top_p',
                            'max_output_tokens',
                        ].includes(key))
                        .map(([key, value], index) => (
                            <ResultTag key={index} value1={key} value2={getStringOrJson(value)} />
                        ))}
                </Space>
            )}

            {activeTrace?.data && activeTrace?.data?.inputs ? (
                <Space direction="vertical" className="w-full" size={24}>
                    {activeTrace?.data?.inputs?.prompt && 
                     Array.isArray(activeTrace?.data?.inputs?.prompt) && 
                     activeTrace?.data?.inputs?.prompt.length > 0 && 
                     activeTrace?.data?.inputs?.prompt.every((item: any) => 'role' in item) ? (
                        Object.entries(transformDataInputs(activeTrace?.data?.inputs)).map(
                            ([key, values]) => {
                                if (key === "prompt") {
                                    return Array.isArray(values)
                                        ? values.map((param, index) => {
                                            // First check for content
                                            if (param.content !== undefined) {
                                                return (
                                                    <AccordionTreePanel
                                                        key={index}
                                                        label={param.role}
                                                        value={param.content}
                                                        enableFormatSwitcher={
                                                            param.role === "assistant" ||
                                                            param.role === "tool"
                                                        }
                                                    />
                                                );
                                            }
                                            // Then check for contents with proper structure
                                            else if (param.contents && 
                                                     Array.isArray(param.contents) && 
                                                     param.contents.length === 1 && 
                                                     param.contents[0].message_content?.text) {
                                                return (
                                                    <AccordionTreePanel
                                                        key={index}
                                                        label={param.role}
                                                        value={param.contents[0].message_content.text}
                                                        enableFormatSwitcher={
                                                            param.role === "assistant" ||
                                                            param.role === "tool"
                                                        }
                                                    />
                                                );
                                            }
                                            // Otherwise show the whole object minus the role
                                            else {
                                                // Create a copy without the role property
                                                const { role, ...paramWithoutRole } = param;
                                                return (
                                                    <AccordionTreePanel
                                                        key={index}
                                                        label={role}
                                                        value={paramWithoutRole}
                                                        enableFormatSwitcher={
                                                            role === "assistant" ||
                                                            role === "tool"
                                                        }
                                                    />
                                                );
                                            }
                                        })
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
                    ) : (
                        <AccordionTreePanel
                            label={"inputs"}
                            value={activeTrace?.data.inputs}
                            enableFormatSwitcher
                        />
                    )}
                </Space>
            ) : null}

            {activeTrace?.data && activeTrace?.data?.outputs ? (
                <Space direction="vertical" className="w-full" size={24}>
                    {activeTrace?.data?.outputs?.completion && 
                     Array.isArray(activeTrace?.data?.outputs?.completion) && 
                     activeTrace?.data?.outputs?.completion.length > 0 && 
                     activeTrace?.data?.outputs?.completion.every((item: any) => 'role' in item) ? (
                        Object.values(activeTrace?.data.outputs).map((item) =>
                            Array.isArray(item)
                                ? item.map((param: any, index) => {
                                    // First check for content
                                    if (param.content !== undefined) {
                                        return (
                                            <AccordionTreePanel
                                                key={index}
                                                label={param.role || "assistant"}
                                                value={param.content}
                                                enableFormatSwitcher={param.role === "assistant" || !param.role}
                                                bgColor={"#E6FFFB"}
                                            />
                                        );
                                    }
                                    // Then check for contents with proper structure
                                    else if (param.contents && 
                                             Array.isArray(param.contents) && 
                                             param.contents.length === 1 && 
                                             param.contents[0].message_content?.text) {
                                        return (
                                            <AccordionTreePanel
                                                key={index}
                                                label={param.role || "assistant"}
                                                value={param.contents[0].message_content.text}
                                                enableFormatSwitcher={param.role === "assistant" || !param.role}
                                                bgColor={"#E6FFFB"}
                                            />
                                        );
                                    }
                                    // Otherwise show the whole object minus the role
                                    else {
                                        // Create a copy without the role property
                                        const { role, ...paramWithoutRole } = param;
                                        const displayRole = role || "assistant";
                                        return (
                                            <AccordionTreePanel
                                                key={index}
                                                label={displayRole}
                                                value={paramWithoutRole}
                                                enableFormatSwitcher={displayRole === "assistant"}
                                                bgColor={"#E6FFFB"}
                                            />
                                        );
                                    }
                                })
                                : null,
                        )
                    ) : (
                        <AccordionTreePanel
                            label={"outputs"}
                            value={activeTrace?.data.outputs}
                            enableFormatSwitcher
                        />
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
