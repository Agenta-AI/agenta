<!-- Owned by the layout lane; assembled into agenta-apps SKILL.md as section 08. -->

## Agent-level layout: `agent-files/.apps/`

`agent-files/.apps/` is your record of the apps you have built. It survives across sessions.
Do these in order; each rule is a checklist item.

1. **First `create_app` in this agent's life:** write `agent-files/.apps/layout.json` as
   `{"version": 1, "created_at": "<ISO 8601>"}`. If the file already exists with a different
   `version`, stop and say so. Do not guess at a migration.
2. **After every app event in this session** (create, update, archive): rewrite
   `agent-files/.apps/registry/<session_id>.json` whole, as
   `{"version": 1, "session_id": "<id>", "apps": [{"slug", "path", "template", "created_at",
   "updated_at", "state", "notes"}]}`. Never write another session's registry file.
3. **Before creating an app:** read every file under `agent-files/.apps/registry/` and merge by
   slug. If the person is asking for something you already built in this session, update it.
   If you built it in another session, say so and offer to recreate it here from the same
   starter.
4. **Repeated feedback:** when the same feedback arrives about the same starter twice across
   sessions, add `agent-files/.apps/notes/<YYYY-MM-DD>-<slug>.md` with one paragraph and the
   session ids. Never edit or delete an existing note.
5. **Scheduled data:** if an app's data is produced on a schedule (a dashboard, a weekly
   sweep), propose a schedule in Triggers and ask whether the app should live at agent level
   (`agent-files/apps/<slug>/`), because a scheduled run writes into its own session, not the
   person's. Default is session level.
6. **Never** put app data files under `.apps/`. **Never** touch `.apps/kit/` unless the person
   asks for branding.
