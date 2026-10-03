## ADDED Requirements

### Requirement: Chat-triggered template creation

The app SHALL provide a Save as template action near Publish/Share that sends a visible export request through the normal chat path. The create-template skill SHALL handle both that request and an equivalent typed request, producing a plugin directory and a validated downloadable zip in session files.

#### Scenario: User clicks the action

- **WHEN** the user selects Save as template
- **THEN** one visible user message invokes the export flow without a separate direct configuration exporter
- **AND** the existing unsent composer draft is preserved and exact placement remains a UI decision

### Requirement: Recipient-aware content

The skill SHALL establish the intended audience, retain useful behavior including reusable memories, and ask when company-specific content should be kept or generalized. It SHALL omit credentials and secret values. It SHALL NOT remove all memory merely because it is under a Memory heading or require a mandatory full-package privacy review.

#### Scenario: General SEO template

- **WHEN** a user wants a reusable SEO agent and company-specific cover design instructions are present
- **THEN** the skill asks whether to retain those conventions or replace them with recipient-supplied preferences

#### Scenario: Team-specific template

- **WHEN** the user explicitly wants to share their company's SEO process with a teammate
- **THEN** the skill retains the requested company conventions and useful feedback while excluding credentials

### Requirement: Contextual setup guidance

The skill SHALL write SETUP.md for the exported package version and intended recipient, explaining prerequisites, connections, missing recipient inputs, relevant company choices, suggested automations and a first-use check. It SHALL map connections to requirements rather than copy project bindings and SHALL leave automations inactive on load.

#### Scenario: New recipient has different accounts

- **WHEN** the original agent used connected accounts and a schedule
- **THEN** setup explains how the recipient chooses their own accounts and reviews the suggested schedule instead of claiming the original accounts transferred

### Requirement: Repairable validation

The skill SHALL create the zip and validate that exact zip with the loader's source resolution and parser before delivery. Repairs SHALL rebuild and revalidate the zip. The API SHALL NOT add a directory-only validation source. Validation SHALL identify file, field, error and corrective next step and SHALL create no workflow, session, registry skill or automation. Failed validation SHALL prevent a success/download reply for that package.

#### Scenario: Missing setup file

- **WHEN** the manifest points to a missing SETUP.md
- **THEN** validation names the path and a fix, and the skill repairs and revalidates or reports the unresolved failure

### Requirement: Evaluate skill quality

The test suite SHALL include end-to-end export attempts with small agent configurations and at least one smaller tool-capable model as well as a reference model. It SHALL record repair attempts, validation success and setup usefulness, and use failures to improve the skill and error messages.

#### Scenario: Smaller model needs a repair

- **WHEN** an export initially fails due to a missing field or file
- **THEN** the evaluation records whether the model repairs it from the returned issue without developer intervention
- **AND** any failure becomes a regression fixture before acceptance
