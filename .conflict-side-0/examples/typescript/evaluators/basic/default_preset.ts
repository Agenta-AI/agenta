/**
 * Default Preset Evaluator (TypeScript)
 * =====================================
 *
 * This example uses TypeScript-only syntax and will fail under the JavaScript runtime.
 */

type OutputValue = string | Record<string, unknown>

defineDefaultPresetEvaluator()

function defineDefaultPresetEvaluator() {
  return function evaluate(
    app_params: Record<string, string>,
    inputs: Record<string, string>,
    output: OutputValue,
    correct_answer: string
  ): number {
    void app_params
    void inputs

    const outputStr =
      typeof output === "string" ? output : JSON.stringify(output)

    return outputStr.includes(correct_answer) ? 1.0 : 0.0
  }
}

const evaluate = defineDefaultPresetEvaluator()
