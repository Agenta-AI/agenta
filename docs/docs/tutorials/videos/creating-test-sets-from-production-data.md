---
title: "Creating Test Sets from Traces"
description: "Learn how to create comprehensive test sets from production traces and playground data for effective LLM evaluation and testing in Agenta."
sidebar_position: 3
---

import Image from "@theme/IdealImage";
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

## Overview 

Creating test sets is one of the most critical parts of building reliable LLM-powered applications. Without test sets, it's very hard to evaluate your application, find edge cases, improve the application for these cases, or discover regressions when they appear.

In this guide, we'll show you how to create test sets in Agenta by using your production data and playground experiments.

<div className="video-container" style={{ position: "relative", paddingBottom: "56.25%", height: 0, overflow: "hidden", maxWidth: "100%", marginBottom: "1rem" }}>
  <iframe 
    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
    src="https://www.youtube.com/embed/GISPYhCeflA?si=7W6MH759qdALKap4" 
    title="Creating Test Sets from Traces and Playground Data" 
    frameBorder="0" 
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowFullScreen
  ></iframe>
</div> 

## What is a Test Set?

A test set is a collection of test cases, each containing:

- **Inputs**: The data your LLM application expects (required)
- **Ground Truth**: The expected answer from your application (optional)
- **Annotations**: Additional metadata or rules about the test case (optional)

The inputs are always required - without them, we can't invoke the LLM application. The ground truth and annotations are optional but provide additional capabilities for evaluation.

## Creating Test Sets from Production Data

### Adding a Single Trace to a Test Set

1. Navigate to the **Observability** view in Agenta
2. Find a trace you want to add to a test set
3. Click the **Add to Test Set** button at the top of the trace view
4. Select "Create New" to make a new test set (or select an existing one)
5. Name your test set (e.g., "docs-test-set")
6. Check the mapping between trace data and test set columns:
7. Optionally, edit the correct answer if you don't agree with the output
8. Click **Save** to add the trace to your test set

### Adding Multiple Traces at Once

1. In the Observability view, use the search function to find related traces
   - For example, search for "I don't have enough information" to find cases where your application couldn't answer
2. Select all relevant traces by checking the boxes next to them
3. Click **Add to Test Set**
4. Choose an existing test set or create a new one
5. Review the mapping for the traces
6. Click **Save** to add all selected traces to your test set

## Creating Test Sets from the Playground

While working in the playground, you may find interesting cases that would make good test examples:

1. Work with your application in the playground
2. When you find an interesting case or edge case, click **Add to Test Set**
3. Select an existing test set or create a new one
4. Review the data mapping
5. Click **Save** to add the case to your test set

## Using Your Test Sets

Once you have a test set, you can use it in several ways:

1. **Load it in the playground**:
   - Click the "Load" button in the playground
   - Select your test set and the specific test cases you want to use
   - Use these test cases to iterate on your prompt or application

2. **Create evaluations**:
   - Use your test set as the basis for automated or human evaluations
   - Compare your application's output against ground truth answers
   - Measure performance across different variants

For more information on evaluations, see our [Evaluation documentation](/evaluation/overview).

## Test Set Best Practices

### Types of Test Sets

1. **Happy Path Tests**:
   - Verify your application works correctly under normal, expected conditions
   - Help ensure core functionality remains intact as you make changes
   - Useful for regression testing and quality assurance

2. **Grumpy Path Tests**:
   - Check how your application handles edge cases or problematic scenarios
   - Include prompt injection attempts, malformed inputs, or out-of-scope requests
   - Help identify vulnerabilities and improve robustness

### Evaluation with Test Sets

Even with just inputs (no ground truth), you can evaluate your application using:

1. **[Human evaluation](/evaluation/human_evaluation)**: Have people review the outputs for quality
2. **[LLM as a judge](/evaluation/evaluators/llm-as-a-judge)**: Use a prompt that assesses outputs based on criteria like relevance or accuracy

Adding ground truth expands your evaluation options, allowing you to:
- Compare outputs against expected answers
- Use metrics like exact match or semantic similarity
- Measure accuracy and quality objectively

## Related Resources

- [Creating Test Sets](/evaluation/create-test-sets)
- [Configuring Evaluators](/evaluation/configure-evaluators)
- [Running Evaluations](/evaluation/no-code-evaluation)
