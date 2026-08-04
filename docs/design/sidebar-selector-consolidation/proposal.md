# Sidebar selector consolidation

The sidebar carries two stacked selectors — one for organization, one for project — and each
hides a submenu of management actions. This proposal merges them into a single dropdown and
narrows that dropdown to viewing, switching, and creating. Every other action moves to Settings,
where most of them already live.

No capability leaves the platform.

## What the sidebar does today

### Organization selector

| Capability | Behavior |
|---|---|
| View organizations | Shows the active org on the button and lists the rest in the dropdown |
| Switch organization | Checks access, then switches |
| Create organization | Opens a name modal |
| Rename organization | Submenu action on the selected org, owner only |
| Transfer ownership | Submenu action, owner only; picks a new owner from workspace members |
| Delete organization | Submenu action, owner only; confirms by typed name |
| Demo badge | Tags orgs flagged `is_demo` |
| Auth upgrade prompt | Opens on `AUTH_UPGRADE_REQUIRED` or `AUTH_SSO_DENIED` |
| Domain denied error | Shows a toast on `AUTH_DOMAIN_DENIED` |
| Logout | Confirms, then ends the session |

### Project selector

| Capability | Behavior |
|---|---|
| View projects | Shows the active project on the button and lists the rest in the dropdown |
| Switch project | Navigates, keeping the current route |
| Create project | Pinned footer action, opens a name modal |
| Rename project | Submenu action on the active project |
| Copy project ID | Copies the ID to the clipboard |
| Set as default | Marks the active project as the org default |
| Delete project | Submenu action; blocked on the default and the last project |
| Default badge | Tags the org's default project |

### Bottom section

| Capability | Behavior |
|---|---|
| Settings | Links to project settings |
| Invite teammate | Deep-links to Settings, Members, with the invite modal open |
| Live chat support | Toggles the Crisp widget; cloud only |
| Help & Docs | Submenu: documentation, GitHub, Slack, book a call |
| Announcement banner | Shows the top-priority banner; dismissible; hidden when collapsed |

## What the sidebar does under this proposal

One dropdown replaces two. The organization sits at the top, projects below it, and a
second-level list handles organization switching.

| Capability | Behavior |
|---|---|
| View organizations | Shows the active org on the button and lists the rest under Switch organization |
| View projects | Shows the active project on the button and lists the rest in the dropdown |
| Switch project | Lists the active org's projects inline |
| Create project | Action below the project list |
| Switch organization | Opens a second-level list of organizations |
| Create organization | Action below that list |
| Logout | Confirms, then ends the session |

The bottom section keeps Settings, Help & Docs, and the announcement banner. Live chat support
joins the Help & Docs submenu.

## What moves

| Capability | Destination | Status |
|---|---|---|
| Rename organization | Settings, Organization, General | Already available |
| Transfer ownership | Settings, Organization, General | Already available |
| Delete organization | Settings, Organization, General | Already available |
| Rename project | Settings, Organization, Projects | Already available |
| Set as default | Settings, Organization, Projects | Already available |
| Delete project | Settings, Organization, Projects | Already available |
| Default badge | Settings, Organization, Projects | Already available |
| Invite teammate | Settings, Organization, Members | Already available |
| Copy project ID | Settings, Organization, Projects | ID already shown; copy action to build |
| Copy organization ID | Settings, Organization, General | To build |
| Demo badge | Settings, Organization, General | To build |
| Live chat support | Help & Docs submenu | Relocates |

Eight of the twelve moved capabilities already have a home in Settings. Three need building
there. One relocates as-is.

## Consequences

**Auth state leaves the sidebar without becoming a settings feature.** The access check runs on
a switch, so it stays with the switch, but the upgrade prompt and the domain-denied error move
to an app-level host driven by a Jotai atom. The sidebar sets the atom and owns nothing else.
This matches the repo's state convention, and any future entry point that switches
organizations reuses the same atom for free.

**Organization switching costs one more click than project switching.** Projects are the
frequent choice; organizations are the rare one. The second-level list prices each accordingly.
