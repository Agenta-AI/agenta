import {useMemo, useState} from "react"

import {annotationSessionController, groupQueueItems} from "@agenta/annotation"
import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
import {Button, CollapseCaret} from "@agenta/ui/ui"
import {SidebarSimple} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {QueueItemRow} from "./QueueItemRow"

type GroupKey = "needsReview" | "completed"

/**
 * The queue's items: "3 of 9 completed" with a bar, then the items in two groups, "Needs review"
 * and "Completed", each with its count and folding. A click opens the item. `onHide` folds the
 * list (wide screens); `onOpened` closes the phone's sheet.
 */
export const QueueItemList = ({onHide, onOpened}: {onHide?: () => void; onOpened?: () => void}) => {
    const t = useT(queueScreensCatalog)
    const ids = useAtomValue(annotationSessionController.selectors.scenarioIds())
    const navigableIds = useAtomValue(annotationSessionController.selectors.focusScenarioIds())
    const statuses = useAtomValue(annotationSessionController.selectors.scenarioStatuses())
    const records = useAtomValue(annotationSessionController.selectors.scenarioRecords())
    const currentId = useAtomValue(annotationSessionController.selectors.currentScenarioId())
    const progress = useAtomValue(annotationSessionController.selectors.progress())
    const navigateToIndex = useSetAtom(annotationSessionController.actions.navigateToIndex)
    const [folded, setFolded] = useState<ReadonlySet<GroupKey>>(new Set())

    const groups = useMemo(() => groupQueueItems(ids, statuses), [ids, statuses])
    const createdAt = useMemo(
        () =>
            new Map(
                records.map((record) => [
                    String(record.id),
                    typeof record.created_at === "string" ? record.created_at : null,
                ]),
            ),
        [records],
    )
    const share = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0
    const open = (id: string) => {
        navigateToIndex(navigableIds.indexOf(id))
        onOpened?.()
    }
    const toggle = (key: GroupKey) =>
        setFolded((current) => {
            const next = new Set(current)
            if (!next.delete(key)) next.add(key)
            return next
        })

    return (
        <nav
            aria-label={t("annotation.queueScreens.itemList")}
            className="flex min-h-0 flex-1 flex-col"
        >
            <div className="flex shrink-0 flex-col gap-2 px-4 pt-3 pb-3">
                <div className="flex min-h-7 items-center justify-between gap-2">
                    <span className="text-label text-foreground">
                        {t("annotation.queueScreens.itemsCompleted", {
                            completed: progress.completed,
                            total: progress.total,
                        })}
                    </span>
                    {onHide ? (
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("annotation.queueScreens.hideItems")}
                            title={t("annotation.queueScreens.hideItems")}
                            onClick={onHide}
                        >
                            <SidebarSimple aria-hidden size={14} />
                        </Button>
                    ) : null}
                </div>
                <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={progress.total}
                    aria-valuenow={progress.completed}
                    className="h-1 overflow-hidden rounded-round bg-muted"
                >
                    <div
                        className="h-full rounded-round bg-foreground"
                        style={{width: `${share}%`}}
                    />
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {(["needsReview", "completed"] as const).map((key) => {
                    const items = groups[key]
                    if (items.length === 0) return null
                    const isFolded = folded.has(key)
                    return (
                        <section key={key} className="flex flex-col">
                            <Button
                                type="button"
                                variant="ghost"
                                aria-expanded={!isFolded}
                                onClick={() => toggle(key)}
                                className="h-auto justify-start gap-1.5 rounded-md px-2 py-1.5 text-left text-label text-foreground aria-expanded:bg-transparent aria-expanded:hover:bg-accent"
                            >
                                <CollapseCaret open={!isFolded} />
                                {t(
                                    key === "needsReview"
                                        ? "annotation.queueScreens.groupNeedsReview"
                                        : "annotation.queueScreens.groupCompleted",
                                )}
                                <span className="font-normal text-muted-foreground">
                                    {items.length}
                                </span>
                            </Button>
                            {isFolded
                                ? null
                                : items.map((id) => (
                                      <QueueItemRow
                                          key={id}
                                          scenarioId={id}
                                          status={statuses[id] ?? null}
                                          createdAt={createdAt.get(id) ?? null}
                                          selected={id === currentId}
                                          onOpen={() => open(id)}
                                      />
                                  ))}
                        </section>
                    )
                })}
            </div>
        </nav>
    )
}
