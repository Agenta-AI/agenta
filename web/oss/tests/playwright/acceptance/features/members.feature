# Tests: members/members.spec.ts -> members/index.ts (OSS)
#        web/ee/tests/playwright/acceptance/members/members.spec.ts (EE)
# RTM IDs: WEB-ACC-MEMBERS-001, WEB-ACC-MEMBERS-002, WEB-ACC-MEMBERS-003, WEB-ACC-MEMBERS-004
# Tags: @scope:members @coverage:light @path:happy @speed:fast
#
# Implementation notes:
# - Members page lives at /settings (default tab = workspace = Members)
# - OSS (no SendGrid): invite generates a link → "Invited user link" modal appears
# - EE (SendGrid enabled): invite sends an email → member appears in list with "Invitation Pending" tag
# - Both flows use the same "Invite Members" button and modal entry point

Feature: Workspace Membership Invitation
  As a workspace owner
  I want to invite members to my workspace
  So that they can collaborate on projects

  Background:
    Given the user is authenticated
    And the user is on the Members settings page

  @light @happy @scope:members @speed:fast @license:oss
  Scenario: Invite a member and receive the invite link (OSS)
    When the user clicks Invite Members and fills in an email address
    And the user submits the invitation
    Then the invited user link modal appears with a shareable URL

  @light @happy @scope:members @speed:fast @license:ee
  Scenario: Invite a member and verify pending state (EE)
    When the user clicks Invite Members, fills in an email address and selects a role
    And the user submits the invitation
    Then the invited member appears in the members list with an Invitation Pending tag

  @light @happy @scope:members @speed:fast @license:ee
  Scenario: Resend an invitation to a pending member (EE)
    Given a pending member invite exists
    When the user opens the actions menu for that member
    And the user clicks Resend invitation
    Then a success confirmation is shown

  @light @happy @scope:members @speed:fast @license:ee
  Scenario: Remove a pending member from the workspace (EE)
    Given a pending member invite exists
    When the user opens the actions menu for that member
    And the user clicks Remove and confirms
    Then the member no longer appears in the members list
