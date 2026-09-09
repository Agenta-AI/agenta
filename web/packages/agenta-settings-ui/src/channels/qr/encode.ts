/**
 * Dependency-free QR Code encoder: byte mode, versions 1 to 40, all four ECC levels.
 *
 * The algorithm structure (capacity tables, Reed-Solomon over GF(256), the module
 * placement order, the eight mask patterns and the penalty rules) follows the
 * "QR Code generator library" by Project Nayuki, which is published under the MIT
 * Licence: https://www.nayuki.io/page/qr-code-generator-library. This file is an
 * independent TypeScript implementation of that algorithm, written for this package.
 * QR Code is a registered trademark of DENSO WAVE INCORPORATED.
 */

export type QrEcc = "L" | "M" | "Q" | "H"

export interface QrMatrix {
    /** Side length in modules, always 4 * version + 17. */
    size: number
    /** Row-major module grid: `modules[y][x]` is true for a dark module. */
    modules: boolean[][]
}

const ECC_ORDER: readonly QrEcc[] = ["L", "M", "Q", "H"]

/** Format-information value of each ECC level, indexed like ECC_ORDER. */
const ECC_FORMAT_BITS: readonly number[] = [1, 0, 3, 2]

/** ECC codewords per block, indexed [eccIndex][version]. Index 0 of each row is unused. */
const ECC_CODEWORDS_PER_BLOCK: readonly (readonly number[])[] = [
    // prettier-ignore
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    // prettier-ignore
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    // prettier-ignore
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    // prettier-ignore
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
]

/** Number of ECC blocks, indexed [eccIndex][version]. Index 0 of each row is unused. */
const ECC_BLOCKS: readonly (readonly number[])[] = [
    // prettier-ignore
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    // prettier-ignore
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    // prettier-ignore
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    // prettier-ignore
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
]

const PENALTY_N1 = 3
const PENALTY_N2 = 3
const PENALTY_N3 = 40
const PENALTY_N4 = 10

const MIN_VERSION = 1
const MAX_VERSION = 40

const getBit = (value: number, index: number): boolean => ((value >>> index) & 1) !== 0

/** Total data plus ECC modules of a version, before the format and version areas. */
const rawDataModules = (version: number): number => {
    let result = (16 * version + 128) * version + 64
    if (version >= 2) {
        const numAlign = Math.floor(version / 7) + 2
        result -= (25 * numAlign - 10) * numAlign - 55
        if (version >= 7) result -= 36
    }
    return result
}

/** Number of 8-bit data codewords a version holds at an ECC level. */
const dataCodewords = (version: number, eccIndex: number): number =>
    Math.floor(rawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[eccIndex][version] * ECC_BLOCKS[eccIndex][version]

/** Character-count field width for byte mode. */
const charCountBits = (version: number): number => (version <= 9 ? 8 : 16)

const alignmentPositions = (version: number): number[] => {
    if (version === 1) return []
    const numAlign = Math.floor(version / 7) + 2
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2
    const size = version * 4 + 17
    const result = [6]
    for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
    return result
}

/** Multiply two field elements of GF(256), modulo the QR primitive polynomial. */
const fieldMultiply = (x: number, y: number): number => {
    let z = 0
    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d)
        z ^= ((y >>> i) & 1) * x
    }
    return z & 0xff
}

const rsDivisor = (degree: number): number[] => {
    const result: number[] = new Array<number>(degree).fill(0)
    result[degree - 1] = 1
    let root = 1
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < degree; j++) {
            result[j] = fieldMultiply(result[j], root)
            if (j + 1 < degree) result[j] ^= result[j + 1]
        }
        root = fieldMultiply(root, 0x02)
    }
    return result
}

const rsRemainder = (data: readonly number[], divisor: readonly number[]): number[] => {
    const result: number[] = new Array<number>(divisor.length).fill(0)
    for (const byte of data) {
        const factor = byte ^ (result.shift() as number)
        result.push(0)
        divisor.forEach((coefficient, i) => {
            result[i] ^= fieldMultiply(coefficient, factor)
        })
    }
    return result
}

/** Split the data codewords into blocks, add ECC to each block, then interleave. */
const addEccAndInterleave = (
    data: readonly number[],
    version: number,
    eccIndex: number,
): number[] => {
    const numBlocks = ECC_BLOCKS[eccIndex][version]
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[eccIndex][version]
    const rawCodewords = Math.floor(rawDataModules(version) / 8)
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
    const shortBlockLen = Math.floor(rawCodewords / numBlocks)

    const divisor = rsDivisor(blockEccLen)
    const blocks: number[][] = []
    for (let i = 0, k = 0; i < numBlocks; i++) {
        const blockDataLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1)
        const block = data.slice(k, k + blockDataLen)
        k += blockDataLen
        const ecc = rsRemainder(block, divisor)
        // Pad the short blocks to one common length. The padding byte is skipped below.
        const padded = i < numShortBlocks ? block.concat([0]) : block
        blocks.push(padded.concat(ecc))
    }

    const result: number[] = []
    for (let i = 0; i < blocks[0].length; i++) {
        for (let j = 0; j < blocks.length; j++) {
            if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
                result.push(blocks[j][i])
            }
        }
    }
    return result
}

interface Grid {
    size: number
    modules: boolean[][]
    isFunction: boolean[][]
}

const newGrid = (size: number): Grid => ({
    size,
    modules: Array.from({length: size}, () => new Array<boolean>(size).fill(false)),
    isFunction: Array.from({length: size}, () => new Array<boolean>(size).fill(false)),
})

const setFunctionModule = (grid: Grid, x: number, y: number, dark: boolean): void => {
    grid.modules[y][x] = dark
    grid.isFunction[y][x] = true
}

const drawFinder = (grid: Grid, x: number, y: number): void => {
    for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
            const distance = Math.max(Math.abs(dx), Math.abs(dy))
            const xx = x + dx
            const yy = y + dy
            if (xx >= 0 && xx < grid.size && yy >= 0 && yy < grid.size) {
                setFunctionModule(grid, xx, yy, distance !== 2 && distance !== 4)
            }
        }
    }
}

const drawAlignment = (grid: Grid, x: number, y: number): void => {
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            setFunctionModule(grid, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
    }
}

const drawFormatBits = (grid: Grid, eccIndex: number, mask: number): void => {
    const data = (ECC_FORMAT_BITS[eccIndex] << 3) | mask
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = (((data << 10) | rem) ^ 0x5412) & 0x7fff
    const size = grid.size

    for (let i = 0; i <= 5; i++) setFunctionModule(grid, 8, i, getBit(bits, i))
    setFunctionModule(grid, 8, 7, getBit(bits, 6))
    setFunctionModule(grid, 8, 8, getBit(bits, 7))
    setFunctionModule(grid, 7, 8, getBit(bits, 8))
    for (let i = 9; i < 15; i++) setFunctionModule(grid, 14 - i, 8, getBit(bits, i))

    for (let i = 0; i < 8; i++) setFunctionModule(grid, size - 1 - i, 8, getBit(bits, i))
    for (let i = 8; i < 15; i++) setFunctionModule(grid, 8, size - 15 + i, getBit(bits, i))
    setFunctionModule(grid, 8, size - 8, true)
}

const drawVersionBits = (grid: Grid, version: number): void => {
    if (version < 7) return
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
        const dark = getBit(bits, i)
        const a = grid.size - 11 + (i % 3)
        const b = Math.floor(i / 3)
        setFunctionModule(grid, a, b, dark)
        setFunctionModule(grid, b, a, dark)
    }
}

const drawFunctionPatterns = (grid: Grid, version: number, eccIndex: number): void => {
    const size = grid.size
    for (let i = 0; i < size; i++) {
        setFunctionModule(grid, 6, i, i % 2 === 0)
        setFunctionModule(grid, i, 6, i % 2 === 0)
    }
    drawFinder(grid, 3, 3)
    drawFinder(grid, size - 4, 3)
    drawFinder(grid, 3, size - 4)

    const positions = alignmentPositions(version)
    const last = positions.length - 1
    for (let i = 0; i <= last; i++) {
        for (let j = 0; j <= last; j++) {
            const corner =
                (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)
            if (!corner) drawAlignment(grid, positions[i], positions[j])
        }
    }

    drawFormatBits(grid, eccIndex, 0)
    drawVersionBits(grid, version)
}

/** Place the codeword bits in the zigzag order, skipping every function module. */
const drawCodewords = (grid: Grid, data: readonly number[]): void => {
    const size = grid.size
    let i = 0
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5
        for (let vert = 0; vert < size; vert++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j
                const upward = ((right + 1) & 2) === 0
                const y = upward ? size - 1 - vert : vert
                if (!grid.isFunction[y][x] && i < data.length * 8) {
                    grid.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7))
                    i++
                }
            }
        }
    }
}

const maskBit = (mask: number, x: number, y: number): boolean => {
    switch (mask) {
        case 0:
            return (x + y) % 2 === 0
        case 1:
            return y % 2 === 0
        case 2:
            return x % 3 === 0
        case 3:
            return (x + y) % 3 === 0
        case 4:
            return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
        case 5:
            return ((x * y) % 2) + ((x * y) % 3) === 0
        case 6:
            return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
        default:
            return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
    }
}

/** Apply a mask by XOR. A second call with the same mask undoes the first. */
const applyMask = (grid: Grid, mask: number): void => {
    for (let y = 0; y < grid.size; y++) {
        for (let x = 0; x < grid.size; x++) {
            if (!grid.isFunction[y][x] && maskBit(mask, x, y)) {
                grid.modules[y][x] = !grid.modules[y][x]
            }
        }
    }
}

const addRunToHistory = (size: number, runLength: number, history: number[]): void => {
    const length = history[0] === 0 ? runLength + size : runLength
    history.pop()
    history.unshift(length)
}

/** Count the 1:1:3:1:1 finder-like patterns that the run history holds. */
const countFinderPatterns = (history: readonly number[]): number => {
    const n = history[1]
    const core =
        n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n
    return (
        (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
        (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
    )
}

const terminateAndCount = (
    size: number,
    runColor: boolean,
    runLength: number,
    history: number[],
): number => {
    let length = runLength
    if (runColor) {
        addRunToHistory(size, length, history)
        length = 0
    }
    addRunToHistory(size, length + size, history)
    return countFinderPatterns(history)
}

const penaltyScore = (grid: Grid): number => {
    const size = grid.size
    let result = 0

    // Rule 1 and rule 3, once along every row and once along every column.
    const scoreLine = (moduleAt: (line: number, index: number) => boolean): number => {
        let lineResult = 0
        for (let line = 0; line < size; line++) {
            let runColor = false
            let runLength = 0
            const history = [0, 0, 0, 0, 0, 0, 0]
            for (let index = 0; index < size; index++) {
                const dark = moduleAt(line, index)
                if (dark === runColor) {
                    runLength++
                    if (runLength === 5) lineResult += PENALTY_N1
                    else if (runLength > 5) lineResult++
                } else {
                    addRunToHistory(size, runLength, history)
                    if (!runColor) lineResult += countFinderPatterns(history) * PENALTY_N3
                    runColor = dark
                    runLength = 1
                }
            }
            lineResult += terminateAndCount(size, runColor, runLength, history) * PENALTY_N3
        }
        return lineResult
    }
    result += scoreLine((y, x) => grid.modules[y][x])
    result += scoreLine((x, y) => grid.modules[y][x])

    for (let y = 0; y < size - 1; y++) {
        for (let x = 0; x < size - 1; x++) {
            const color = grid.modules[y][x]
            if (
                color === grid.modules[y][x + 1] &&
                color === grid.modules[y + 1][x] &&
                color === grid.modules[y + 1][x + 1]
            ) {
                result += PENALTY_N2
            }
        }
    }

    let dark = 0
    for (const row of grid.modules) for (const module of row) if (module) dark++
    const total = size * size
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
    return result + k * PENALTY_N4
}

const toUtf8Bytes = (text: string): number[] => Array.from(new TextEncoder().encode(text))

/**
 * Encode text as a QR Code symbol in byte mode.
 *
 * The smallest version that holds the text at the given ECC level is used. The
 * mask with the lowest penalty score is applied.
 *
 * @throws Error if the text is too long for version 40 at that ECC level.
 */
export const encodeQr = (text: string, ecc: QrEcc = "M"): QrMatrix => {
    const eccIndex = ECC_ORDER.indexOf(ecc)
    if (eccIndex < 0) throw new Error(`encodeQr: unknown ECC level "${ecc}"`)

    const bytes = toUtf8Bytes(text)
    let version = 0
    for (let candidate = MIN_VERSION; candidate <= MAX_VERSION; candidate++) {
        const capacityBits = dataCodewords(candidate, eccIndex) * 8
        if (4 + charCountBits(candidate) + bytes.length * 8 <= capacityBits) {
            version = candidate
            break
        }
    }
    if (version === 0) {
        throw new Error(
            `encodeQr: ${bytes.length} bytes do not fit in a version 40 symbol at ECC level ${ecc}`,
        )
    }

    // Build the bit stream: mode indicator, character count, then the data bytes.
    const bits: boolean[] = []
    const appendBits = (value: number, width: number): void => {
        for (let i = width - 1; i >= 0; i--) bits.push(getBit(value, i))
    }
    appendBits(0b0100, 4)
    appendBits(bytes.length, charCountBits(version))
    for (const byte of bytes) appendBits(byte, 8)

    const capacityBits = dataCodewords(version, eccIndex) * 8
    appendBits(0, Math.min(4, capacityBits - bits.length))
    appendBits(0, (8 - (bits.length % 8)) % 8)
    for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(pad, 8)

    const codewords: number[] = new Array<number>(bits.length / 8).fill(0)
    bits.forEach((bit, i) => {
        if (bit) codewords[i >>> 3] |= 0x80 >>> (i & 7)
    })

    const size = version * 4 + 17
    const grid = newGrid(size)
    drawFunctionPatterns(grid, version, eccIndex)
    drawCodewords(grid, addEccAndInterleave(codewords, version, eccIndex))

    let bestMask = 0
    let bestScore = Number.POSITIVE_INFINITY
    for (let mask = 0; mask < 8; mask++) {
        applyMask(grid, mask)
        drawFormatBits(grid, eccIndex, mask)
        const score = penaltyScore(grid)
        if (score < bestScore) {
            bestScore = score
            bestMask = mask
        }
        applyMask(grid, mask)
    }
    applyMask(grid, bestMask)
    drawFormatBits(grid, eccIndex, bestMask)

    return {size, modules: grid.modules}
}
