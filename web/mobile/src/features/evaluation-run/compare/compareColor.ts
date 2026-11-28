/**
 * The color of a run in a comparison, by its slot: the base run is 0, the compared runs 1 to 4.
 * The data colors `data-1` to `data-5` in order (COLOR-05), so a chip, a row marker and a bar of
 * one run match.
 */
export const compareColor = (slot: number) => `var(--data-${slot + 1})`
