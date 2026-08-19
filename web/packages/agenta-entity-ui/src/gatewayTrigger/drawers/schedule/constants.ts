/**
 * Module-level configuration for the schedule drawer. Kept local to the drawer — the
 * subscription drawer declares its own knobs with its own semantics.
 */

// Weekly (Monday 09:00 UTC) so the builder opens on the Weekly cadence by default.
export const DEFAULT_CRON = "0 9 * * 1"
// A schedule fires a synthetic tick; there is no provider event, but the data
// model still requires an `event_key`. We use a stable schedule-tick key.
export const SCHEDULE_EVENT_KEY = "schedule.tick"
