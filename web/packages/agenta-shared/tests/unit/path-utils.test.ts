import {describe, expect, it} from "vitest"

import {
    deleteValueAtPath,
    getValueAtPath,
    hasValueAtPath,
    setValueAtPath,
} from "../../src/utils/pathUtils"

// ---------------------------------------------------------------------------
// getValueAtPath
// ---------------------------------------------------------------------------

describe("getValueAtPath — basic object navigation", () => {
    const data = {user: {profile: {name: "Alice", age: 30}}}

    it("retrieves a deeply nested value", () => {
        expect(getValueAtPath(data, ["user", "profile", "name"])).toBe("Alice")
    })

    it("returns the root when the path is empty", () => {
        expect(getValueAtPath(data, [])).toBe(data)
    })

    it("returns undefined for a missing key", () => {
        expect(getValueAtPath(data, ["user", "missing"])).toBeUndefined()
    })

    it("returns undefined when traversal hits null", () => {
        expect(getValueAtPath({a: null}, ["a", "b"])).toBeUndefined()
    })
})

describe("getValueAtPath — array indexing", () => {
    it("accesses array elements by numeric index", () => {
        expect(getValueAtPath([10, 20, 30], [1])).toBe(20)
    })

    it("accesses array elements by string index", () => {
        expect(getValueAtPath([10, 20, 30], ["2"])).toBe(30)
    })

    it("returns undefined for out-of-bounds index", () => {
        expect(getValueAtPath([10, 20], [5])).toBeUndefined()
    })

    it("navigates mixed array/object paths", () => {
        const data = {items: [{id: "a"}, {id: "b"}]}
        expect(getValueAtPath(data, ["items", 1, "id"])).toBe("b")
    })
})

describe("getValueAtPath — JSON string traversal", () => {
    it("parses a JSON string and continues traversal", () => {
        const data = {messages: '{"content": "hello"}'}
        expect(getValueAtPath(data, ["messages", "content"])).toBe("hello")
    })

    it("returns undefined when the string is not valid JSON", () => {
        const data = {messages: "not json"}
        expect(getValueAtPath(data, ["messages", "content"])).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// setValueAtPath
// ---------------------------------------------------------------------------

describe("setValueAtPath — object mutation (immutable)", () => {
    it("sets a nested value without mutating the original", () => {
        const data = {user: {name: "Alice"}}
        const updated = setValueAtPath(data, ["user", "name"], "Bob")
        expect((updated as typeof data).user.name).toBe("Bob")
        expect(data.user.name).toBe("Alice")
    })

    it("creates intermediate objects for new paths", () => {
        const data = {}
        const updated = setValueAtPath(data, ["a", "b"], 42) as {a: {b: number}}
        expect(updated.a.b).toBe(42)
    })

    it("replaces the root when path is empty", () => {
        expect(setValueAtPath({a: 1}, [], "new")).toBe("new")
    })
})

describe("setValueAtPath — array mutation (immutable)", () => {
    it("sets an array element by index", () => {
        const arr = [1, 2, 3]
        const updated = setValueAtPath(arr, [1], 99) as number[]
        expect(updated[1]).toBe(99)
        expect(arr[1]).toBe(2)
    })

    it("handles nested array+object paths", () => {
        const data = {items: [{id: "a"}, {id: "b"}]}
        const updated = setValueAtPath(data, ["items", 0, "id"], "z") as typeof data
        expect(updated.items[0].id).toBe("z")
        expect(updated.items[1].id).toBe("b")
    })
})

describe("setValueAtPath — JSON string re-serialisation", () => {
    it("parses a JSON string, sets the value, and re-stringifies", () => {
        const data = {messages: '{"content": "hello"}'}
        const updated = setValueAtPath(data, ["messages", "content"], "world") as typeof data
        expect(updated.messages).toBe('{"content":"world"}')
    })
})

// ---------------------------------------------------------------------------
// deleteValueAtPath
// ---------------------------------------------------------------------------

describe("deleteValueAtPath — object", () => {
    it("removes a key from a nested object (immutable)", () => {
        const data = {user: {name: "Alice", age: 30}}
        const updated = deleteValueAtPath(data, ["user", "age"]) as typeof data
        expect(updated.user).not.toHaveProperty("age")
        expect(updated.user.name).toBe("Alice")
        expect(data.user.age).toBe(30)
    })

    it("returns data unchanged when path is empty", () => {
        const data = {a: 1}
        expect(deleteValueAtPath(data, [])).toBe(data)
    })
})

describe("deleteValueAtPath — array", () => {
    it("removes an element from an array by index", () => {
        const result = deleteValueAtPath([10, 20, 30], [1]) as number[]
        expect(result).toEqual([10, 30])
    })
})

// ---------------------------------------------------------------------------
// hasValueAtPath
// ---------------------------------------------------------------------------

describe("hasValueAtPath", () => {
    it("returns true when the key exists", () => {
        expect(hasValueAtPath({a: {b: 1}}, ["a", "b"])).toBe(true)
    })

    it("returns false when the key is missing", () => {
        expect(hasValueAtPath({a: {}}, ["a", "missing"])).toBe(false)
    })

    it("returns false when a parent is null", () => {
        expect(hasValueAtPath({a: null}, ["a", "b"])).toBe(false)
    })

    it("returns true for valid array index", () => {
        expect(hasValueAtPath([10, 20, 30], [2])).toBe(true)
    })

    it("returns false for out-of-bounds array index", () => {
        expect(hasValueAtPath([10, 20], [5])).toBe(false)
    })

    it("returns true for the root when path is empty and data is defined", () => {
        expect(hasValueAtPath({a: 1}, [])).toBe(true)
    })
})
