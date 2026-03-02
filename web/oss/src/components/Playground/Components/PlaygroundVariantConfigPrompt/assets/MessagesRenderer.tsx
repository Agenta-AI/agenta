import React, {useCallback, useMemo} from "react"

import {useSetAtom} from "jotai"

import {getPromptById, getArrayVal} from "@/oss/components/Playground/context/promptShape"
import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"

import {deletePromptMessageMutationAtomFamily} from "../../../state/atoms/promptMutations"
import PromptMessageConfig from "../../PromptMessageConfig"
import SharedEditor from "../../SharedEditor"

interface Props {
    variantId: string
    compoundKey: string
    promptId: string
    viewOnly?: boolean
}

const MessagesRenderer: React.FC<Props> = ({promptId, variantId, compoundKey, viewOnly}) => {
    const prompts = usePromptsSource(variantId)
    const {messageIds, rawMessages} = useMemo(() => {
        const item = getPromptById(prompts, promptId)
        const arr = getArrayVal(item?.messages)
        const ids = arr.map((m: any) => m?.__id).filter(Boolean)
        return {messageIds: ids, rawMessages: arr}
    }, [prompts, promptId, compoundKey])

    const deleteMessageSetter = useSetAtom(deletePromptMessageMutationAtomFamily(compoundKey))
    const deleteMessage = useCallback(
        (messageId: string) => deleteMessageSetter({messageId}),
        [deleteMessageSetter],
    )
    return (
        <>
            {messageIds && messageIds.length > 0
                ? messageIds.map((messageId: string) => {
                      return (
                          <PromptMessageConfig
                              key={`${variantId}:${messageId}-${viewOnly}`}
                              variantId={variantId}
                              messageId={messageId}
                              deleteMessage={viewOnly ? undefined : deleteMessage}
                              editorType="border"
                              editorClassName="min-h-4 [&_p:last-child]:!mb-0"
                              isMessageDeletable={!viewOnly && (messageIds?.length || 0) > 1}
                              viewOnly={viewOnly}
                              defaultMinimized
                          />
                      )
                  })
                : // Fallback for immutable/raw prompts without property ids
                  (rawMessages || []).map((m: any, idx: number) => {
                      // Handle both raw format (role: "user") and enhanced format (role: {value: "user"})
                      const role = typeof m?.role === "string" ? m.role : (m?.role?.value ?? "user")
                      const content = m?.content?.value ?? m?.content
                      const text = Array.isArray(content)
                          ? content
                                .map(
                                    (p: any) =>
                                        p?.text?.value || p?.text || p?.image_url?.url || "",
                                )
                                .filter(Boolean)
                                .join("\n\n")
                          : typeof content === "string"
                            ? content
                            : JSON.stringify(content ?? "", null, 2)

                      return (
                          <div
                              key={`${variantId}:${idx}-${viewOnly}`}
                              className="flex flex-col gap-1"
                          >
                              <div className="flex items-center gap-2">
                                  <span className="message-user-select px-2 py-[2px] text-[12px] leading-[16px] border border-solid border-[rgba(5,23,41,0.15)] rounded-md text-[#1C2C3D] bg-white">
                                      {role}
                                  </span>
                              </div>
                              <SharedEditor
                                  initialValue={text}
                                  key={`${variantId}:${idx}-${viewOnly}`}
                                  editorProps={{
                                      codeOnly: false,
                                      enableTokens: false,
                                      showToolbar: false,
                                  }}
                                  editorType="border"
                                  className="w-full"
                                  state="readOnly"
                              />
                          </div>
                      )
                  })}
        </>
    )
}

export default MessagesRenderer
