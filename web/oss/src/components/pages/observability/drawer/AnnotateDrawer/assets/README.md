# AnnotateDrawer System

## Overview

The `AnnotateDrawer` UI component is a multi-step drawer that allows users to:

- View and manage their annotations
- Select and add evaluators (criteria/metrics)
- Create new evaluators

The drawer orchestrates several sub-components, each handling a specific step in the annotation process.

## Component Interactions

- `AnnotateDrawer` manages the overall state and passes relevant props to sub-components.
- `Annotate` receives annotation and metric data, and allows users to input or modify metric values.
- `SelectEvaluators` allows users to choose which evaluators to use; updates local storage and state.
- `AnnotateDrawerTitle` reflects the current step and provides navigation and save actions.
- `CreateEvaluator` allows users to create new evaluators.

## State Variables (in `AnnotateDrawer`)

| State Variable           | Purpose                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `annotations`            | Stores the filtered, deduplicated list of annotations for the current user/project.                                                     |
| `steps`                  | Tracks the current step in the drawer (Annotate, SelectEvaluators, CreateEvaluator).                                                    |
| `updatedMetrics`         | Holds the current values for each evaluator's metrics (used for annotation input).                                                      |
| `activeCollapse`         | Controls which UI sections are expanded/collapsed in the collapse section.                                                              |
| `selectedEvaluators`     | The list of evaluator slugs selected by the user (persisted in local storage for project scope).                                        |
| `tempSelectedEvaluators` | Temporarily holds evaluator slugs that are present in annotations but not currently displayed (ex: annotations created by other users). |

## Effects (in `AnnotateDrawer`)

### 1. Annotation Filtering and Deduplication

- **Purpose:** Ensures only the latest annotation for each evaluator is shown, and only those created by the current user, from the web, and of kind "human" are included.
- **Logic:**
    - Annotations are sorted by creation date.
    - Duplicates (by evaluator slug) are removed, keeping only the latest.
    - Only annotations matching the user/web/human criteria are kept in `annotations`.
    - Other evaluator slugs are added to `tempSelectedEvaluators` to display as new annotation for other users.

### 2. Evaluator and Metric State Management (in `Annotate`)

- **Purpose:** Initializes and updates the `updatedMetrics` state when evaluators or annotations got selected.
- **Logic:**
    - When evaluators are selected, default metric values are generated for each using the `getDefaultValue()` function.
    - When annotations change, metric values are initialized from the latest annotation data.

## Data Transformations

### In `Annotate`:

- **Metric Initialization For Selected Evaluators:**  
  For each selected evaluator, generates a metrics object with default values based on the evaluator’s schema using the `getDefaultValue()` function.
- **Metric Update For Existing Annotations:**  
  When annotations are loaded, populates metric values from the annotation data, it triggers a `useEffect` hook and by using the `getInitialMetricsFromAnnotations()` function it extracts the metrics and notes from annotations and updates the `updatedMetrics` state.

## Transform Functions

The following functions are defined in `assets/transforms`.

1. **`transformMetadata`**:
    - What it does: Takes an object (data) and transforms each key-value pair into a metadata format to make use of the `PlaygroundControlUI` components. It sorts the result by type priority (number > boolean > others > string).

2. **`getInitialMetricsFromAnnotations`**:
    - What it does: Given an array of AnnotationDto objects, extracts the initial metrics and notes from each annotation and organizes them by evaluator slug into an object format.

3. **`generateAnnotationPayload`**:
    - What it does: Compares original and updated metrics for each annotation. If there are changes, it creates a payload object containing only the changed annotations, ready to be sent to the backend for updating.
    - Where/Why used: Used when saving or submitting annotation edits. Only changed annotations are included in the payload, which is efficient and prevents unnecessary updates.

4. **`generateNewAnnotationPayloadData`**:
    - What it does: For a set of selected evaluators, constructs new annotation payloads using updated metrics. It ensures all required schema properties are present (using getDefaultValue), sanitizes the data with `payloadSchemaSanitizer` function, and formats the annotation object for backend submission.
    - Where/Why used: Used when creating new annotations for one or more evaluators, such as when a user adds new metrics/notes for traces/spans that haven't been annotated yet.

5. **`generateNewEvaluatorPayloadData`**:
    - What it does: It takes a set of created metrics and constructs a new evaluator payload data.
    - Where/Why used: Used when creating new evaluator.

6. **`getDefaultValue`**:
    - What it does: Recursively generates a default value for a property based on its schema type (string, number, boolean, object, array, etc.). Optionally skips non-primitive types if ignoreNonPrimitive is true.
    - Where/Why used: Used when creating new annotation using evaluator or filling in missing values according to a schema, ensuring all required fields are present and have sensible defaults.

7. **`payloadSchemaSanitizer`**:
    - What it does: Recursively sanitizes a data object according to a provided JSON-like schema. Ensures all values match their schema-defined types, fills in defaults for missing/null values, and handles nested objects/arrays.
    - Where/Why used: Used before sending newly created annotation data using evaluator to the backend to guarantee type safety and completeness, preventing errors due to missing or incorrectly-typed values.

## Currently supported metric types (2/6/2025)

- `integer`: A numeric metric that can only take integer values.
    - Eval data structure: `{type: "integer", minimum: 0, maximum: 100}`
- `number`: A numeric metric that can take both integer and floating-point values.
    - Eval data structure: `{type: "number", minimum: 0, maximum: 100}`
- `string`: A metric that can take string values.
    - Eval data structure: `{type: "string"}`
- `boolean`: A metric that can take boolean values.
    - Eval data structure: `{type: "boolean"}`
- `label/array`: A metric that can take an array of string values.
    - Eval data structure: `{metric-name: {type: "array", items: {type: "string", enum: ["option1", "option2"]}, uniqueItems: true}}`
    - Annotate data structure: `{metric-name: ["option1", "option2"]}`
- `class`: A metric that can take a either string or null value.
    - Eval data structure: `metric-name: {anyOf: [{type: ["string", null], enum: ["option1", "option2", null]}]}`
    - Annotate data structure: `{metric-name: "something" || null}`

### Metric infos

- `optional metric`: If a metric is optional and it's not annotated yet then we are not sending that metric to the backend.
- `required metric`: If a metric is required and it's not annotated yet then blocking the API call and showing the error message to the user.
- `null value metric`: Only `class` metric can have null value and can send null value to the backend. All the other required metric have to annotate with a value and the optional metric will note be sent to the backend.

## Notes for Developers

- **State Persistence:**  
  Selected evaluators are stored in local storage, scoped by project ID.
- **Extensibility For New Steps Component:**  
  To add new steps or evaluator types, update the enums/types in `assets/enum` and `assets/types`.
- **Data Integrity For Annotations:**  
  Deduplication and filtering logic ensures a clean and user-specific annotation view.
- **Payload Data Miss Match:**  
  If payload data miss match for the new annotation data, check the `payloadSchemaSanitizer()` function first.
- **Error For Non Used Properties:**  
  If endpoint gives error for non used properties (e.g. object, array, etc), check the `getDefaultValue()` function first.
- **Temporary Selected Evaluators:**
  We are using temporary selected evaluators to display the new annotation for other users instead of showing original created user annotations.
- **Debugging:**
  We are using `console.log("ANNOTATE, <function_name>: <message>")` to debug the code. The way it's working is first we are adding a unique key to search on the browser console in this case it's `ANNOTATE` and then we are adding the name of the function to know where the console.log() is coming from and finally we are adding the message.
