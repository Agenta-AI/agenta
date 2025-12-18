// /**
//  * Simplified hook backed by normalized entities
//  * - inputRows derived from inputRowIdsAtom
//  * - messageRows synthesized from chatTurnsByIdAtom using baseline assistant
//  */
// export const useChatGenerationData = () => {
//     const turns = useAtomValue(chatTurnsByIdAtom) as Record<string, any>
//     const rowIds = useAtomValue(inputRowIdsAtom) as string[]
//     const displayed = useAtomValue(displayedVariantsAtom) as string[]
//     const baseline = displayed?.[0]

//     return useMemo(() => {
//         const inputRows = (rowIds || []).map((id) => ({__id: id}))
//         const messageRows = Object.values(turns || {}).map((t: any) => ({
//             __id: t?.id,
//             history: {
//                 value: [
//                     t?.userMessage,
//                     baseline ? t?.assistantMessageByRevision?.[baseline] : null,
//                 ].filter(Boolean),
//             },
//         }))

//         const totalHistoryItems = messageRows.reduce(
//             (total: number, row: any) => total + (row.history?.value?.length || 0),
//             0,
//         )

//         return {
//             inputRows,
//             messageRows,
//             selectedSource: "normalized",
//             totalHistoryItems,
//         }
//     }, [turns, rowIds, baseline])
// }
