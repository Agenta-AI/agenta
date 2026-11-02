/** Boolean metric colouring, shared by the metric cell and the annotations panel. */
export const booleanValueColorClass = (value: boolean): string =>
    value ? "text-green-7 dark:text-[var(--ant-green-7)]" : "text-orange-6"
