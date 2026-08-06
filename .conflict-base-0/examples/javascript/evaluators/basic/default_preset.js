/**
 * Character Count Match Test (JavaScript)
 * ======================================
 *
 * Simple evaluator that compares character counts for output vs correct answer.
 * This mirrors the Python exact_match example without NumPy.
 */

function evaluate(appParams, inputs, output, correctAnswer) {
  void appParams
  void inputs

  try {
    const outputStr =
      typeof output === "string" ? output : JSON.stringify(output)
    const answerStr = String(correctAnswer)

    return outputStr.length === answerStr.length ? 1.0 : 0.0
  } catch {
    return 0.0
  }
}
