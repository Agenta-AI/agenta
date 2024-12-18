# Understanding mappingOptions Logic

## Overview
The `mappingOptions` useMemo in TestsetDrawer.tsx handles automatic mapping between trace data fields and testset columns. The mapper analyzes trace data structure and matches it with testset columns intelligently.

## Core Steps

### 1. Collection Phase
```typescript
const uniquePaths = new Set<string>()

// Collect all possible paths from trace data
traceData.forEach((traceItem) => {
    const traceKeys = collectKeyPathsFromObject(traceItem?.data, "data")
    traceKeys.forEach((key) => uniquePaths.add(key))
})
```

This phase:
- Creates a Set to store unique data paths
- Uses `collectKeyPathsFromObject` to extract paths from each trace
- Prefixes all paths with "data."

### 2. Initial Mapping Creation
```typescript
const mappedData = Array.from(uniquePaths).map((item) => ({value: item}))
```
Converts unique paths into mapping option format.

### 3. Auto-Matching Logic
When both trace data and testset exist:

a. Creates case-insensitive lookup for testset columns:
```typescript
const testsetColumnsSet = new Set(
    selectedTestsetColumns.map((item) => item.column.toLowerCase())
)
```

b. For each path:
- Extracts last segment (e.g., "prompt" from "data.inputs.prompt")
- Tries exact matches with existing columns
- Applies special case rule: "outputs" → "correct_answer"

Example:
```typescript
// Input
Path: "data.inputs.prompt"
Testset columns: ["prompt", "correct_answer"]

// Processing
Last segment: "prompt"
Matches existing column: true
Result: maps to "prompt"

// Special Case
Path: "data.outputs"
Last segment: "outputs"
Special case match: maps to "correct_answer"
```

### 4. Column Management
- Updates selected columns list
- Preserves existing columns
- Marks new columns with `isNew` flag
- Prevents duplicate column names

## Example Mappings

### Simple Match
```typescript
// Input Trace
{
  data: {
    inputs: {
      prompt: "Hello"
    }
  }
}

// Path: "data.inputs.prompt"
// Maps to: "prompt" column (exact match)
```

### Special Case Match
```typescript
// Input Trace
{
  data: {
    outputs: "Response"
  }
}

// Path: "data.outputs"
// Maps to: "correct_answer" column (special case)
```

### New Column Creation
```typescript
// Input Trace
{
  data: {
    inputs: {
      temperature: 0.7
    }
  }
}

// Path: "data.inputs.temperature"
// Creates new: "temperature" column
```

## Validation Features

1. **Duplicate Prevention**
- Tracks used column names
- Warns on duplicates
- Blocks saving until resolved

2. **Case Sensitivity**
- Matching is case-insensitive
- Preserves original column case
- Maintains testset consistency

3. **Column Tracking**
- Flags new columns vs existing
- Requires confirmation for new columns
- Preserves existing column order
