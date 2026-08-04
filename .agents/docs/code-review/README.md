# Code Review Artifact Structure

This document defines the structure of files and folders used by a code‑review agent.  Each artifact has a clear role in the lifecycle of a review, from the fixed harness through working memory and finally to the user‑facing outputs.  The descriptions below explain when to use each artifact, why it is a file or a folder, whether it is optional, and whether it is mutable or append‑only.  A summary table at the end provides a quick reference.

## 1 Harness (fixed reference files)

These files and folders define **how** reviews should be performed and what file structure to use.  They live outside of any individual run and change infrequently.

### `guidelines.md`  – Global file structure overview

* **Purpose:** Provides an overview of the entire code‑review file structure.  It explains the roles of each file and folder, how they fit together, and offers a quick reference for new users.
* **When to use:** Consult this file when setting up a new review process or onboarding a team member.  It is the first place to look to understand where to place information and where to find specific artifacts.
* **When not to use:** Do not use it to store actual review content or instructions; those belong in the other harness files.  Avoid duplicating detailed instructions or rubrics here.
* **Why a file:** A single guidelines document centralises the structure description and makes it easy to discover.  It provides a human‑readable entry point without requiring multiple documents.
* **Optional?** Recommended.  While not strictly required for a review to function, a guidelines file improves discoverability and onboarding.
* **Mutable?** Mutable but updated infrequently.  Edit it when the file structure evolves.

### `instructions.md`  – Review guidelines

* **Purpose:** Contains general review procedures, best practices, and common checks.  It sets expectations for reviewers and ensures consistency across runs.
* **When to use:** Always consult this file at the start of a review to understand the process and rubric.  Agents should reference it when deciding what constitutes a finding or how to classify severities.
* **When not to use:** Do not store run‑specific notes or scope here.  It should not be modified by an agent during a review.
* **Why a file:** Instructions are relatively stable and apply globally across projects; storing them in a single file simplifies maintenance.
* **Optional?** Required – a review should not start without knowing the instructions.
* **Mutable?** Mutable but rarely edited.  Updates are made centrally to refine the review process, not within individual runs.

### `deliverables.md`  – Output requirements

* **Purpose:** Defines the required and optional outputs of a review (e.g., findings, summary, patch).  It describes formats, severity levels, and acceptance criteria.
* **When to use:** Read at the beginning of a project to know what artifacts must be produced.  Agents can check this file to ensure all mandatory outputs are generated.
* **When not to use:** It is not used to store actual deliverables or findings.
* **Why a file:** Deliverable definitions are stable across runs and are most useful as a single reference document.
* **Optional?** Required.  This file ensures the agent understands what it must produce.
* **Mutable?** Mutable but updated only by administrators when deliverable requirements change.

### `templates/`  – Template folder

* **Purpose:** Holds reusable templates for different artifacts (e.g., issue format, summary layout, scorecard skeleton).  Templates ensure consistent formatting across reviews.
* **When to use:** When creating a new artifact, agents should start from the appropriate template file in this folder.
* **When not to use:** Do not store run‑specific content here.  Templates should not be edited during a review.
* **Why a folder:** Multiple template files may exist (one per artifact), so a folder keeps them organised.
* **Optional?** Optional.  If templates are not provided, agents may build the artifacts manually, but consistency may suffer.
* **Mutable?** Template files can be updated centrally but should remain static during a run.

### `rubrics/`  – Rubric folder

* **Purpose:** Contains one file per review type (e.g., security, performance, migration) specifying criteria, scoring ranges, and domain‑specific checks.
* **When to use:** Select the appropriate rubric(s) before planning a review.  Agents may consult them when scoring issues or deciding risk levels.
* **When not to use:** Do not mix rubrics with findings or run notes; rubrics describe evaluation standards only.
* **Why a folder:** Each review type can have its own rubric file, and new types can be added without modifying existing ones.
* **Optional?** Optional.  If your organisation does not use detailed rubrics, this folder may be empty.
* **Mutable?** Mutable at the administrative level; rubric files should not be altered mid‑review.

## 2 Per‑run input

These artifacts define **what** is being reviewed and why.  They originate from the user or requester.

### `scope.md`  – Scope definition

* **Purpose:** Describes the scope of the current review, including the codebase/branch, modules included or excluded, the goals of the review, and any constraints or context provided by the requestor.
* **When to use:** Created at the beginning of each review run.  The agent uses it to understand boundaries and to avoid analysing unrelated parts of the codebase.
* **When not to use:** Do not edit this file during the review to record progress or findings.  It is the baseline contract of the review.
* **Why a file:** The scope is a single, definitive statement for the run.  A file suffices because scope is typically concise and does not require multiple subdocuments.
* **Optional?** Required.  A review cannot start without a defined scope.
* **Mutable?** Immutable during the run; once defined, it should not change unless the requester updates the review brief.

## 3 Per‑run execution

These files track **how** the agent intends to conduct the review and what the current state is.

### `plan.md`  – Review plan

* **Purpose:** Outlines the agent’s planned approach: which files or modules to review first, hypotheses about risk areas, prioritisation of checks, and planned passes.
* **When to use:** Generated at the outset of the review based on the scope, instructions and rubric.  It should be updated only if the plan needs to adapt significantly.
* **When not to use:** Do not record progress or actual findings here.  Keep it high‑level and forward‑looking.
* **Why a file:** The plan is a single, coherent narrative; storing it in one file makes it easy to read and update.
* **Optional?** Required.  A clear plan helps ensure structured reviews and repeatability.
* **Mutable?** Mutable.  It may be updated as the agent adjusts its strategy, but such changes should be rare and well‑justified.

### `progress.md`  – Review progress

* **Purpose:** Records the current execution state: which files have been reviewed, which checks are complete, outstanding tasks, and any blockers or time estimates.
* **When to use:** Update this file regularly during the review to reflect progress and provide transparency.  It complements the plan by showing actual execution.
* **When not to use:** Do not include findings, evidence or reasoning here.  It is strictly about status.
* **Why a file:** Progress can be tracked as a checklist or table in a single file.  One file suffices to keep all tasks and their statuses together.
* **Optional?** Required for long or complex reviews.  Optional for trivial reviews with a single pass.
* **Mutable?** Mutable.  Entries and statuses can be updated as tasks progress; you can mark items complete, adjust estimates or reorder rows.  Append new entries when needed but do not be afraid to update existing ones.

## 4 Per‑run working memory

These artifacts capture **thinking** and **evidence** during the review.  They are internal to the agent and not part of the final deliverables.

### `notes/`  – Scratchpad folder

* **Purpose:** Serves as the reviewers’ scratchpad.  Each agent, pass or concern area can have its own file within this folder to record hypotheses, tentative observations and questions that are not yet promoted to findings.
* **When to use:** Write to this folder during the analysis phase.  Use separate files to avoid conflicts when multiple agents or passes run concurrently.  Reviewers can later revisit these notes when formulating findings.
* **When not to use:** Do not store definitive evidence or final findings here.  Notes are provisional and may contain false positives.
* **Why a folder:** A folder supports parallel work streams (by agent, pass or module).  It prevents a single file from becoming cluttered.
* **Optional?** Optional for simple reviews but highly recommended when multiple agents collaborate or when reviews are complex.
* **Mutable?** Mutable.  Files within this folder are freely edited during a review; they may be appended, reorganised or removed as needed.

### `evidence/`  – Evidence folder

* **Purpose:** Stores concrete proof for each issue or hypothesis, such as code snippets, line ranges, reproduction steps, logs or command outputs.  Each evidence file can correspond to a specific finding or a reviewed file.
* **When to use:** Whenever you identify something notable, create or update an evidence file to capture the supporting material.  Link to these evidence files from findings.
* **When not to use:** Do not use evidence files for narrative explanations; save that for the notes or findings.  Also avoid duplicating entire source files.
* **Why a folder:** Evidence is modular; splitting it into multiple files avoids an unwieldy monolith and makes cross‑referencing easier.
* **Optional?** Required for any non‑trivial finding.  Optional in reviews that yield no issues.
* **Mutable?** Mutable.  Evidence files may be updated or reorganised as new information emerges.  You can refine sections, add clarifications or extend snippets; try to avoid deleting useful context.

### `metadata.json`  – Structured state

* **Purpose:** Stores machine‑readable metadata about the review.  Fields might include the review ID, timestamps, list of reviewed files, counts of findings by severity, and completion flags.
* **When to use:** The agent updates this file programmatically as the review progresses.  It can be read by orchestration tools or dashboards to track status.
* **When not to use:** Do not include human‑readable notes or evidence; keep it structured for consumption by software.
* **Why a file:** JSON is well suited for structured data and can be easily parsed by tools.  A single file suffices because metadata is centrally maintained.
* **Optional?** Optional but recommended when automation or dashboards are used.
* **Mutable?** Mutable.  Fields may be updated or added as the review evolves.

## 5 Per‑run promoted outputs

These artifacts contain **conclusions** drawn from the working memory and are intended for consumption by stakeholders.

### `findings.md`  – Confirmed issues

* **Purpose:** Lists all confirmed issues discovered during the review.  Each entry includes its severity, location, a clear description, an explanation of why it matters, references to relevant evidence, and a recommended remediation.  Remediation should present one or more options to address the issue, with optional code changes or patch snippets where applicable.  Entries are typically organised as rows of a table with columns for each attribute, making it easy to scan and update.  Alternatively, each finding can be documented as its own subsection with subheadings for each column attribute (e.g., Issue ID, Description, Evidence, Remediation), giving a table‑list structure that scales when entries are verbose.
* **When to use:** Populate this file throughout or at the end of the review when provisional notes are promoted to findings.  When adding an issue, include its supporting evidence and remediation options.
* **When not to use:** Do not include unverified suspicions or non‑issues.  Keep it concise and focused on actionable defects.
* **Why a file:** Findings need to be presented in a single coherent list to stakeholders.  A file allows sequential organisation and easy referencing.
* **Optional?** Required when issues are found.  If no issues are found, this file may be empty or omitted.
* **Mutable?** Mutable.  The table of findings can be expanded with new entries or updated with clarifications, improved explanations or remediation options.  Avoid deleting entries unless they are duplicates; mark resolved items clearly.

### `risks.md`  – Broader concerns

* **Purpose:** Captures high‑level risks that might not be direct defects, such as maintainability concerns, architectural weaknesses or potential performance bottlenecks.  Each risk entry should include a description, an explanation of the potential impact, references to relevant evidence, and recommended mitigation options.  Mitigation should present one or more approaches, with optional code snippets or patch guidance where applicable.  Risks should be presented as a table with columns for category, description, impact, evidence references and mitigation options.  Alternatively, each risk can be written as its own subsection with subheadings for these attributes, creating a table‑list layout that improves readability when entries are lengthy.
* **When to use:** Use this file when you identify system‑wide or non‑blocking issues that stakeholders should be aware of.  When adding a risk, include supporting evidence and multiple mitigation options if there are different ways to address it.
* **When not to use:** Do not duplicate confirmed defects here; those belong in `findings.md`.  Avoid speculating without evidence.
* **Why a file:** A separate file helps distinguish general risks from actionable defects, aiding prioritisation.
* **Optional?** Optional.  Include it only when such risks are identified.
* **Mutable?** Mutable.  Risk entries can be added or updated as your understanding of the system evolves.  If a risk is resolved or mitigated, note the outcome rather than deleting the row.

### `questions.md`  – Clarifications needed

* **Purpose:** Lists questions for the code author or requestor that block understanding or prevent conclusions.  Each question should be clear and reference the related code or context.  Entries should also provide a brief explanation of why the question matters, refer to relevant evidence, and, where possible, propose potential directions or provisional suggestions (which may include more than one option) to explore once the question is answered.  Questions should be captured in table form with columns for the question, explanation, evidence references, provisional suggestions, and status (e.g., open, resolved).  Alternatively, each question may be organised as its own subsection with subheadings for these attributes, giving a table‑list structure that is easier to read when the answers or explanations are long.
* **When to use:** Whenever ambiguity arises that cannot be resolved internally.  Early recording of questions helps avoid delays.  Include supporting evidence and any provisional suggestions or options that may help once the question is addressed.
* **When not to use:** Do not store rhetorical questions or brainstorming here; those belong in `notes/`.  Only include questions that need external answers.
* **Why a file:** A single list of unanswered questions helps facilitate efficient communication with stakeholders.
* **Optional?** Optional.  Omit if no clarifications are needed.
* **Mutable?** Mutable.  Questions may be added, updated, marked as resolved, or expanded with additional context.  Retain the history of asked questions for transparency.

## 7 Per‑run synthesis

These artifacts summarise the review for quick consumption by decision‑makers.

### `summary.md`  – Narrative summary

* **Purpose:** Provides a human‑readable overview of the review: overall health, key issues, risk posture, and next steps.  It should reference the main findings and recommendations without duplicating all details.
* **When to use:** Generate at the end of the review after findings and recommendations are finalised.  Use it when communicating results to stakeholders who may not read the full findings file.
* **When not to use:** Do not insert new findings or recommendations here; the summary should only draw from existing files.
* **Why a file:** It stands as the primary document for executive stakeholders.  A single markdown file keeps the narrative cohesive.
* **Optional?** Required for most reviews.  Exceptions may include internal or ad‑hoc checks where a formal summary is unnecessary.
* **Mutable?** Mutable until the review concludes; once delivered, treat as final.

### `scorecard.md`  – Structured report card

* **Purpose:** Offers a concise, structured overview of the review, often as a table or list: number of findings by severity, risk scores, confidence levels, review coverage and readiness recommendation.
* **When to use:** Use alongside the summary for stakeholders who prefer quick metrics.  Scorecards help in comparing multiple reviews or tracking improvement over time.
* **When not to use:** Avoid narrative explanations here; those belong in the summary.  Do not overload the scorecard with long descriptions.
* **Why a file:** Separating metrics from narrative improves readability and allows automated tooling to parse scorecards easily.
* **Optional?** Optional but recommended.  It is particularly useful when multiple reviews need to be aggregated or when managers require at‑a‑glance status.
* **Mutable?** Mutable until the review is finalised; afterwards, treat it as static.

## 8 Summary timeline / sequence

The artifacts above follow a typical sequence:

1. **Harness (fixed)** – `guidelines.md`, `instructions.md`, `deliverables.md`, `templates/`, and `rubrics/` are prepared by administrators and read before starting a review.
2. **Define scope** – Create `scope.md` based on the requester’s brief.
3. **Plan** – Draft `plan.md` using scope and rubrics.
4. **Execute and record progress** – Update `progress.md` as you work, and use `notes/` and `evidence/` to capture thoughts and proof.  Maintain `metadata.json` if automation is needed.
5. **Promote outputs** – When ready, consolidate confirmed issues in `findings.md`, broader concerns in `risks.md`, and unresolved questions in `questions.md`.  For each entry, include its explanation, references to evidence, and recommended remediation.  Remediation should offer one or more possible options and may include code or diff snippets where appropriate.
6. **Synthesize** – Produce `summary.md` and `scorecard.md` at the end of the review for stakeholders.

## 9 Quick reference table

The table below summarises the key properties of each artifact.  It uses short phrases rather than full sentences to remain concise.

| Artifact | Type (file/folder) | Required? | Mutability |
|---|---|---|---|
| `instructions.md` | File | Yes | Mutable, rarely edited |
| `guidelines.md` | File | Recommended | Mutable, rarely edited |
| `deliverables.md` | File | Yes | Mutable, rarely edited |
| `templates/` | Folder | No | Static during run |
| `rubrics/` | Folder | No | Static during run |
| `scope.md` | File | Yes | Immutable during run |
| `plan.md` | File | Yes | Mutable |
| `progress.md` | File | Usually | Mutable (checklist) |
| `notes/` | Folder | Optional | Mutable |
| `evidence/` | Folder | Optional* | Mutable |
| `metadata.json` | File | Optional | Mutable |
| `findings.md` | File | If issues | Mutable (table) |
| `risks.md` | File | Optional | Mutable (table) |
| `questions.md` | File | Optional | Mutable (table) |
| `summary.md` | File | Usually | Mutable until final |
| `scorecard.md` | File | Optional | Mutable until final |

\*Evidence is not needed if the review uncovers no issues or if the scope is extremely small.