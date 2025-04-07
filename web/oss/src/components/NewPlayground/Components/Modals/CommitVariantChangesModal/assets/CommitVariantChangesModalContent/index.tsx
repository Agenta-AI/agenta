import {useCallback} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import {Input, Radio, RadioChangeEvent, Typography} from "antd"

import CommitNote from "@/oss/components/NewPlayground/assets/CommitNote"
import Version from "@/oss/components/NewPlayground/assets/Version"
import usePlayground from "@/oss/components/NewPlayground/hooks/usePlayground"
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
    const {variantName, revision, targetRevision} = usePlayground({
        variantId,
        hookId: "CommitVariantChangesModal",
        variantSelector: useCallback((variant: EnhancedVariant) => {
            return {
                variantName: variant.variantName,
                revision: variant.revision as number,
                targetRevision: variant._parentVariant.revision + 1,
            }
        }, []),
    })

    const onChange = (e: RadioChangeEvent) => {
        setSelectedCommitType({...selectedCommitType, type: e.target.value})
    }

    return (
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
                    />
                    <Version revision={1} />
                </div>
            </div>

            <CommitNote note={note} setNote={setNote} />
        </section>
    )
}

export default CommitVariantChangesModalContent
