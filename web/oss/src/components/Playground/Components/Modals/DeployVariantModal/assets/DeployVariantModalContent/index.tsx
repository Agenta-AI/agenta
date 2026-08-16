import {VariantNameCell} from "@agenta/entity-ui/variant"
import {CommitMessageInput, Tag, VersionBadge} from "@agenta/ui"
import {Skeleton} from "@agenta/ui/ui"
import {useAtom, useAtomValue} from "jotai"

import {deployNoteAtom, deploySelectedEnvAtom} from "../../store/deployVariantModalStore"

import {deployModalEnvironmentsTableAtom} from "./tableDataAtom"

/** The environments picker — a plain radio table (three rows), replacing antd Table. */
const DeployVariantModalContent = ({variantName, revision, isLoading}: any) => {
    const {rows, isPending: isEnvironmentsPending} = useAtomValue(deployModalEnvironmentsTableAtom)
    const [selectedEnvName, setSelectedEnvName] = useAtom(deploySelectedEnvAtom)
    const [note, setNote] = useAtom(deployNoteAtom)

    // The rows come from the environments query, so the skeleton has to track THAT — not just
    // the publish mutation, or the placeholder rows would be pickable as deployment targets.
    const showSkeleton = Boolean(isLoading) || isEnvironmentsPending

    return (
        <section className="flex flex-col gap-4" data-tour="deploy-variant-modal">
            <span className="text-xs text-colorText">
                Select an environment to deploy <span className="font-medium">{variantName}</span>{" "}
                {typeof revision !== "undefined" && (
                    <VersionBadge version={revision} variant="chip" />
                )}
            </span>

            <div className="ph-no-capture overflow-hidden rounded-md border border-solid border-colorBorderSecondary">
                <table className="w-full border-collapse text-xs">
                    <thead>
                        <tr className="border-0 border-b border-solid border-colorBorderSecondary bg-colorFillQuaternary text-left">
                            <th className="w-12 px-3 py-2 font-medium" aria-label="Select" />
                            <th className="min-w-[160px] px-3 py-2 font-medium text-colorText">
                                Environment
                            </th>
                            <th className="min-w-[160px] px-3 py-2 font-medium text-colorText">
                                Current variant
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {showSkeleton ? (
                            <tr>
                                <td colSpan={3} className="px-3 py-3">
                                    <Skeleton className="h-16 w-full" />
                                </td>
                            </tr>
                        ) : (
                            rows.map((record) => (
                                <tr
                                    key={record.name}
                                    onClick={() => setSelectedEnvName([record.name])}
                                    className="cursor-pointer border-0 border-b border-solid border-colorBorderSecondary last:border-b-0 hover:bg-colorFillQuaternary"
                                >
                                    <td className="px-3 py-2">
                                        <input
                                            type="radio"
                                            name="deploy-environment"
                                            aria-label={`Deploy to ${record.name}`}
                                            checked={selectedEnvName.includes(record.name)}
                                            onChange={() => setSelectedEnvName([record.name])}
                                            className="accent-[var(--ag-colorPrimary)]"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <Tag env={record.name} />
                                    </td>
                                    <td className="px-3 py-2">
                                        <VariantNameCell
                                            revisionId={record.deployedAppVariantRevisionId as any}
                                            revisionName={record.deployedVariantName}
                                            showBadges={false}
                                            hideDiscard
                                        />
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <CommitMessageInput value={note} onChange={setNote} />
        </section>
    )
}

export default DeployVariantModalContent
