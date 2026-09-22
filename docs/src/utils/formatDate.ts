/** "12 August 2026" — the one date style used across the changelog and roadmap. */
const formatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(date: string | Date): string {
  return formatter.format(new Date(date));
}
