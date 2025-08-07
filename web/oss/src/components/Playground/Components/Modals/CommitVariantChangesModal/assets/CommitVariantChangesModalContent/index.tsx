import {useCallback} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import {Input, Radio, RadioChangeEvent, Typography} from "antd"

import DiffView from "@/oss/components/Editor/DiffView"
import CommitNote from "@/oss/components/Playground/assets/CommitNote"
import Version from "@/oss/components/Playground/assets/Version"
import usePlayground from "@/oss/components/Playground/hooks/usePlayground"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

import {CommitVariantChangesModalContentProps} from "../types"

const {Text} = Typography

const CommitVariantChangesModalContent = ({
    variantId,
    note,
    setNote,
    selectedCommitType,
    setSelectedCommitType,
}: CommitVariantChangesModalContentProps) => {
    const {variantName, revision, targetRevision, params, oldParams} = usePlayground({
        variantId,
        hookId: "CommitVariantChangesModal",
        variantSelector: useCallback((variant: EnhancedVariant) => {
            return {
                variantName: variant.variantName,
                revision: variant.revision as number,
                targetRevision: variant._parentVariant.revision + 1,
                params: transformToRequestBody({variant})?.ag_config,
                oldParams: variant?.parameters,
            }
        }, []),
    })

    const onChange = (e: RadioChangeEvent) => {
        setSelectedCommitType({...selectedCommitType, type: e.target.value})
    }

    return (
        <div className="flex gap-4">
            <section className="flex flex-col gap-4">
                <Text>How would you like to save the changes?</Text>

                <div className="flex flex-col gap-1">
                    <Radio
                        value="version"
                        checked={selectedCommitType?.type === "version"}
                        onChange={onChange}
                    >
                        As a new version
                    </Radio>
                    <div className="ml-6 flex items-center gap-2">
                        <Text className="font-medium">{variantName}</Text>
                        <div className="flex items-center gap-2">
                            <Version revision={revision} />
                            <ArrowRight size={14} />
                            <Version revision={targetRevision} />
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <Radio
                        value="variant"
                        checked={selectedCommitType?.type === "variant"}
                        onChange={onChange}
                    >
                        As a new variant
                    </Radio>
                    <div className="ml-6 flex items-center gap-2">
                        <Input
                            placeholder="A unique variant name"
                            className="w-[200px]"
                            value={selectedCommitType?.name}
                            onChange={(e) =>
                                setSelectedCommitType({...selectedCommitType, name: e.target.value})
                            }
                            suffix={<Version revision={1} />}
                        />
                    </div>
                </div>

                <CommitNote note={note} setNote={setNote} />
            </section>
            <div className="w-[100%] max-h-[600px] overflow-y-auto">
                <DiffView
                    original={JSON.stringify(oldParams)}
                    modified={JSON.stringify(params)}
                    language="json"
                    className="border rounded-lg"
                    debounceMs={1000}
                    showErrors={true}
                />
            </div>
        </div>
    )
}

export default CommitVariantChangesModalContent
