# Railway preview requests from PR comments

## Purpose

Let authorized maintainers request a temporary Railway preview directly from a pull request and see the exact deployed revision and expiry.

## ADDED Requirements

### Requirement: Recognize a standalone PR comment command

The system SHALL accept a newly created human comment whose trimmed body is exactly `/preview` on a pull request. It SHALL ignore ordinary issue comments, edited comments, bot comments, quoted commands, and commands embedded in other text. It MUST NOT interpret comment content as shell code, a branch name, an image tag or a duration.

#### Scenario: Start from the PR discussion

- **WHEN** an eligible maintainer posts `/preview` on an eligible PR
- **THEN** the system accepts a preview request for that PR without requiring its number as a command argument.

#### Scenario: Ignore noncommands

- **WHEN** a comment contains `Please run /preview`, a code block containing `/preview`, `/preview 24h`, or shell syntax appended to the command
- **THEN** no preview is created or extended.

#### Scenario: Ignore edited or automated comments

- **WHEN** an existing comment is edited to `/preview` or a bot creates that comment
- **THEN** no preview action occurs.

### Requirement: Check current authorization and PR eligibility

Before any build or Railway mutation, the system MUST check the comment author's current repository permission through GitHub. Only write, maintain or admin permission SHALL authorize the command. The PR MUST be open, non-draft and originate in the same repository. Permission lookup failure MUST deny the request without starting infrastructure. Trust SHALL NOT be inferred solely from author association or PR authorship.

#### Scenario: Authorized maintainer

- **WHEN** the author has write access and the PR is open, non-draft and from the same repository
- **THEN** the request proceeds to revision resolution.

#### Scenario: Reader requests a preview

- **WHEN** the author lacks the required permission
- **THEN** no infrastructure starts and the system records a denied request without exposing credentials.

#### Scenario: Ineligible PR

- **WHEN** a maintainer requests a preview on a fork PR, a closed PR or a draft PR
- **THEN** no infrastructure starts and the response explains the restriction.

### Requirement: Deploy the resolved PR revision through trusted control code

The system SHALL resolve and record the PR head commit when accepting a request, then build or reuse images verified to belong to that commit. The command handler and credential-bearing deployment code MUST come from the trusted default branch. The PR checkout MUST NOT supply scripts or workflows that receive Railway credentials. The system MUST NOT deploy the default branch merely because the comment event or workflow dispatch runs on it.

#### Scenario: Comment event uses the default branch

- **WHEN** a comment event runs on main but the PR head is a different commit
- **THEN** the preview uses the resolved PR commit and reports that exact commit.

#### Scenario: Reuse an existing image

- **WHEN** all required images have verified provenance for the resolved commit
- **THEN** the system can deploy those images without rebuilding them and without using an unverified mutable tag.

#### Scenario: PR head moves before provisioning

- **WHEN** the PR head changes after acceptance but before infrastructure creation
- **THEN** the stale request is cancelled with an explanation rather than silently deploying another commit.

#### Scenario: Untrusted repository content

- **WHEN** a PR changes its workflow files, deployment scripts or image-build scripts
- **THEN** those changes cannot replace the trusted command handler or acquire Railway control credentials through the comment workflow.

### Requirement: Duplicate requests do not increase lifetime or resource count

Repeated delivery of one comment and new `/preview` comments while a manual preview is starting or available SHALL return the current status without creating another environment or extending its deadline. If the PR head has changed, the response SHALL identify the existing deployed revision rather than misrepresenting it as current.

#### Scenario: Event redelivery

- **WHEN** GitHub delivers the same accepted comment twice
- **THEN** only one request is processed and one preview lifetime is granted.

#### Scenario: Comment while preview is available

- **WHEN** another `/preview` comment arrives before the existing manual deadline
- **THEN** the response reports the same URL, revision and deadline without renewing the preview.

#### Scenario: Restart after expiry

- **WHEN** the previous preview has expired and an authorized maintainer posts a new `/preview` comment
- **THEN** the system processes a new bounded request after reconciling any previous environment.

### Requirement: Publish honest lifecycle status

The system SHALL maintain a bot-owned PR preview status comment. It SHALL show the state, resolved commit, workflow link, and, when ready, the preview URL and absolute UTC expiry. Deleted automatic previews SHALL show `/preview` instructions. Cleanup failure MUST NOT be reported as successful shutdown. Updates MUST identify the system's own comment by author and marker rather than trusting a marker in a user's comment.

#### Scenario: Preview becomes ready

- **WHEN** the manual preview passes readiness checks
- **THEN** the bot comment shows the URL, deployed commit, expiry and a warning that preview data is disposable.

#### Scenario: Automatic preview is deleted

- **WHEN** post-test deletion is verified
- **THEN** the comment marks the preview stopped and explains that `/preview` starts another temporary preview.

#### Scenario: Cleanup fails

- **WHEN** Railway deletion fails or cannot be verified
- **THEN** the comment reports cleanup pending or failed, not stopped, and links to the failed operation.
