/**
 * The color of a run in a comparison, by its slot: the base run is 0, the compared runs 1 to 4.
 * The same tokens color the chart series, so a chip, a row marker and a bar of one run match.
 */
export const compareColor = (slot: number) => `var(--ag-chart-series-${slot})`
