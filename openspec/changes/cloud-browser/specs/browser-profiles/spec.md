# Browser profiles

## Purpose

Let a user save one browser identity, logged in to the sites they choose, so that their agents can use those sites later without the user present.

## ADDED Requirements

### Requirement: Organization gate
Agenta SHALL show and accept browser profile operations only when the organization flag `allow_browser` is on. Only an organization admin SHALL be able to change the flag. When the flag is on, any project member SHALL be able to create their own profiles.

#### Scenario: Flag off
- **WHEN** a member opens Settings in an organization where `allow_browser` is off
- **THEN** Agenta SHALL NOT show the Browser logins tab, and the API SHALL refuse browser profile requests

#### Scenario: Admin turns the flag on
- **WHEN** an organization admin turns `allow_browser` on
- **THEN** every member of the organization's projects SHALL be able to create a profile

#### Scenario: Member tries to change the flag
- **WHEN** a member who is not an organization admin tries to change `allow_browser`
- **THEN** Agenta SHALL refuse the change

### Requirement: Profile ownership
A browser profile SHALL belong to exactly one user, its owner, inside one project. In v1 a profile SHALL NOT be shared with other members or with the project.

#### Scenario: Another member lists profiles
- **WHEN** a member who is not the owner lists browser profiles in the project
- **THEN** Agenta SHALL NOT return the owner's profiles to that member

### Requirement: Create a profile
The owner SHALL create a profile with a name and an allowlist of sites. One profile SHALL hold logins to any number of sites on its allowlist. A new profile SHALL start in the `pending_login` state.

#### Scenario: Create with an allowlist
- **WHEN** a member creates a profile named "Ops" with the sites `app.example.com` and `portal.example.org`
- **THEN** Agenta SHALL store the profile with that owner, name, and allowlist, in the `pending_login` state

### Requirement: Log in through the live view
The owner SHALL log in to sites on the allowlist through the live view. When the owner presses Done, Agenta SHALL read the browser session state (cookies and site storage), store it in a write-only vault secret linked to the profile, increase the profile generation by one, and set the state to `ready`.

#### Scenario: Successful login
- **WHEN** the owner logs in to `app.example.com` in the live view and presses Done
- **THEN** Agenta SHALL store the session state, increase the generation, and set the profile to `ready`

#### Scenario: Log in again
- **WHEN** the owner chooses "Log in again" on a profile in any state and presses Done after logging in
- **THEN** Agenta SHALL replace the stored session state, increase the generation, and set the profile to `ready`

### Requirement: Only session state is stored
Agenta SHALL store only browser session state for a profile. Agenta SHALL NOT store a password, a one-time code, or a 2FA secret, and SHALL NOT offer a field for them.

#### Scenario: Login form with a password
- **WHEN** the owner types a password into a site's login form in the live view
- **THEN** Agenta SHALL pass the keystrokes to the browser and SHALL NOT record or store the password

### Requirement: Attach a profile to an agent
An agent config SHALL name at most one browser profile. Only the profile owner SHALL be able to set or change the profile reference to their profile.

#### Scenario: Owner attaches a profile
- **WHEN** the owner selects their profile "Ops" in the Browser section of an agent config and commits
- **THEN** the agent revision SHALL name that profile

#### Scenario: Someone else's profile
- **WHEN** a member commits an agent config that sets the profile reference to a profile they do not own
- **THEN** Agenta SHALL refuse the commit

### Requirement: Delete a profile
The owner SHALL be able to delete a profile at any time. Deleting SHALL archive the profile and permanently delete its vault secret.

#### Scenario: Owner deletes a profile
- **WHEN** the owner deletes the profile "Ops"
- **THEN** Agenta SHALL archive the profile, permanently delete its stored session state, and fail later runs that name it with `profile_not_available`

### Requirement: Owner leaves the organization
When the owner is removed from the organization, Agenta SHALL delete all of the owner's profiles in that organization in the same way as a delete by the owner.

#### Scenario: Owner removed
- **WHEN** an admin removes a member who owns two profiles
- **THEN** Agenta SHALL delete both profiles and their stored session state

### Requirement: Retention of unused profiles
Agenta SHALL keep a profile and its session state until the owner deletes it or the owner leaves the organization. Agenta SHALL NOT expire a profile because it was not used.

#### Scenario: Profile unused for a year
- **WHEN** a profile has not been used by any run for 365 days
- **THEN** Agenta SHALL keep the profile and its stored session state unchanged
