import {Space} from "antd"
import {useAtomValue} from "jotai"

import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {
    spanDataInputsAtomFamily,
    spanDataInternalsAtomFamily,
    spanDataOutputsAtomFamily,
    spanExceptionAtomFamily,
    spanMetaConfigurationAtomFamily,
    spanNodeTypeAtomFamily,
} from "@/oss/state/newObservability/selectors/tracing"

import AccordionTreePanel from "../../../AccordionTreePanel"
import {transformDataInputs} from "../../utils"

const OverviewTabItem = ({activeTrace}: {activeTrace: TraceSpanNode}) => {
    const metaConfig = useAtomValue(spanMetaConfigurationAtomFamily(activeTrace))
    const inputs = useAtomValue(spanDataInputsAtomFamily(activeTrace))
    const outputs = useAtomValue(spanDataOutputsAtomFamily(activeTrace))
    const internals = useAtomValue(spanDataInternalsAtomFamily(activeTrace))
    const nodeType = useAtomValue(spanNodeTypeAtomFamily(activeTrace))
    const exception = useAtomValue(spanExceptionAtomFamily(activeTrace))

    return (
        <Space orientation="vertical" size={24} className="w-full">
            {metaConfig && (
                <Space style={{flexWrap: "wrap"}}>
                    {Object.entries(metaConfig)
                        .filter(([key]) =>
                            [
                                "model",
                                "temperature",
                                "base_url",
                                "top_p",
                                "max_output_tokens",
                            ].includes(key),
                        )
                        .map(([key, value], index) => (
                            <ResultTag key={index} value1={key} value2={getStringOrJson(value)} />
                        ))}
                </Space>
            )}

            {inputs ? (
                <Space orientation="vertical" className="w-full" size={24}>
                    {activeTrace?.span_type !== "embedding" &&
                    inputs?.prompt &&
                    Array.isArray(inputs?.prompt) &&
                    inputs?.prompt.length > 0 &&
                    inputs?.prompt.every((item: any) => "role" in item) ? (
                        Object.entries(transformDataInputs(inputs)).map(([key, values]) => {
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
                                              )
                                          }
                                          // Then check for contents with proper structure
                                          else if (
                                              param.contents &&
                                              Array.isArray(param.contents) &&
                                              param.contents.length === 1 &&
                                              param.contents[0].message_content?.text
                                          ) {
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
                                              )
                                          }
                                          // Otherwise show the whole object minus the role
                                          else {
                                              // Create a copy without the role property
                                              const {role, ...paramWithoutRole} = param
                                              return (
                                                  <AccordionTreePanel
                                                      key={index}
                                                      label={role}
                                                      value={paramWithoutRole}
                                                      enableFormatSwitcher={
                                                          role === "assistant" || role === "tool"
                                                      }
                                                  />
                                              )
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
                        })
                    ) : (
                        <AccordionTreePanel label={"inputs"} value={inputs} enableFormatSwitcher />
                    )}
                </Space>
            ) : null}

            {outputs ? (
                <Space orientation="vertical" className="w-full" size={24}>
                    {activeTrace?.span_type !== "embedding" &&
                    outputs?.completion &&
                    Array.isArray(outputs?.completion) &&
                    outputs?.completion.length > 0 &&
                    outputs?.completion.every((item: any) => "role" in item) ? (
                        Object.values(outputs).map((item) =>
                            Array.isArray(item)
                                ? item.map((param: any, index) => {
                                      // First check for content
                                      if (param.content !== undefined) {
                                          return (
                                              <AccordionTreePanel
                                                  key={index}
                                                  label={param.role || "assistant"}
                                                  value={param.content}
                                                  enableFormatSwitcher={
                                                      param.role === "assistant" || !param.role
                                                  }
                                                  bgColor={"#E6FFFB"}
                                              />
                                          )
                                      }
                                      // Then check for contents with proper structure
                                      else if (
                                          param.contents &&
                                          Array.isArray(param.contents) &&
                                          param.contents.length === 1 &&
                                          param.contents[0].message_content?.text
                                      ) {
                                          return (
                                              <AccordionTreePanel
                                                  key={index}
                                                  label={param.role || "assistant"}
                                                  value={param.contents[0].message_content.text}
                                                  enableFormatSwitcher={
                                                      param.role === "assistant" || !param.role
                                                  }
                                                  bgColor={"#E6FFFB"}
                                              />
                                          )
                                      }
                                      // Otherwise show the whole object minus the role
                                      else {
                                          // Create a copy without the role property
                                          const {role, ...paramWithoutRole} = param
                                          const displayRole = role || "assistant"
                                          return (
                                              <AccordionTreePanel
                                                  key={index}
                                                  label={displayRole}
                                                  value={paramWithoutRole}
                                                  enableFormatSwitcher={displayRole === "assistant"}
                                                  bgColor={"#E6FFFB"}
                                              />
                                          )
                                      }
                                  })
                                : null,
                        )
                    ) : (
                        <AccordionTreePanel
                            label={"outputs"}
                            value={outputs}
                            enableFormatSwitcher
                        />
                    )}
                </Space>
            ) : null}

            {internals && (
                <Space orientation="vertical" className="w-full" size={24}>
                    {nodeType !== "chat" && (
                        <AccordionTreePanel
                            label={"internals"}
                            value={internals}
                            enableFormatSwitcher
                        />
                    )}
                </Space>
            )}

            {exception && (
                <Space orientation="vertical" className="w-full" size={24}>
                    <AccordionTreePanel
                        label={"Exception"}
                        value={exception}
                        enableFormatSwitcher
                        bgColor="#FBE7E7"
                    />
                </Space>
            )}
        </Space>
    )
}

export default OverviewTabItem
