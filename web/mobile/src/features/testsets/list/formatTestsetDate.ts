const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {dateStyle: "medium"})

/** The Date Created cell: a short date, or a dash when the testset has no date. */
export const formatTestsetDate = (value: string | null | undefined): string => {
    if (!value) return "—"
    const time = Date.parse(value)
    return Number.isNaN(time) ? "—" : DATE_FORMAT.format(time)
}
