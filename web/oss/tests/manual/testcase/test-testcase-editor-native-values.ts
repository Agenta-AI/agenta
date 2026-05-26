import assert from "node:assert/strict"

import {inferPrimitiveFromText} from "../../../../packages/agenta-entity-ui/src/testcase/TestcasePrimitiveValue.utils"

// Numbers: clean integers and decimals coerce.
assert.equal(inferPrimitiveFromText("5"), 5)
assert.equal(typeof inferPrimitiveFromText("5"), "number")
assert.equal(inferPrimitiveFromText("5.5"), 5.5)
assert.equal(inferPrimitiveFromText("-3"), -3)
assert.equal(inferPrimitiveFromText("0"), 0)

// Booleans: case-insensitive.
assert.equal(inferPrimitiveFromText("true"), true)
assert.equal(inferPrimitiveFromText("True"), true)
assert.equal(inferPrimitiveFromText("FALSE"), false)

// Preserve strings that look numeric but carry formatting intent
// (IDs, version segments, exponents, leading zeros, padding).
assert.equal(inferPrimitiveFromText("5.0"), "5.0")
assert.equal(inferPrimitiveFromText("0123"), "0123")
assert.equal(inferPrimitiveFromText("1e10"), "1e10")
assert.equal(inferPrimitiveFromText(" 5"), " 5")
assert.equal(inferPrimitiveFromText("5 dollars"), "5 dollars")
assert.equal(inferPrimitiveFromText("hello"), "hello")
assert.equal(inferPrimitiveFromText(""), "")

console.log("testcase editor native value tests passed")
