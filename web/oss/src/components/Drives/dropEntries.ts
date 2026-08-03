/**
 * Reading a file drop. A dropped DIRECTORY shows up on `dataTransfer.files` as a single 0-byte
 * pseudo-file named after the folder, so its real contents have to come from the entries API
 * (`DataTransferItem.webkitGetAsEntry`), walked recursively. Every drop handler in the drive goes
 * through {@link readDroppedFiles}, which yields the flat list of files plus where each one lands
 * relative to the drop destination.
 */

/** A file picked for upload plus its path relative to the destination folder. */
export interface DroppedFile {
    file: File
    /** "notes.txt" for a plain file, "myfolder/sub/a.txt" for one inside a dropped folder. */
    relativePath: string
}

/** The slice of the DOM's `FileSystemEntry` the walk needs — structural so tests can fake a tree. */
export interface DropEntry {
    isFile: boolean
    isDirectory: boolean
    name: string
    file?: (onSuccess: (file: File) => void, onError?: (error: unknown) => void) => void
    createReader?: () => DropEntryReader
}

/** The slice of the DOM's `FileSystemDirectoryReader` the walk needs. */
export interface DropEntryReader {
    readEntries: (
        onSuccess: (entries: DropEntry[]) => void,
        onError?: (error: unknown) => void,
    ) => void
}

const join = (prefix: string, name: string): string => (prefix ? `${prefix}/${name}` : name)

/** A file entry's File, or null if the browser refuses it (a deleted/unreadable file). */
const entryFile = (entry: DropEntry): Promise<File | null> =>
    new Promise((resolve) => {
        if (!entry.file) return resolve(null)
        entry.file(
            (file) => resolve(file),
            () => resolve(null),
        )
    })

/** One directory's children. `readEntries` returns at most ~100 per call and signals the end with an
 * empty batch, so it has to be called in a loop until then — a single call silently truncates. */
const readAllEntries = async (reader: DropEntryReader): Promise<DropEntry[]> => {
    const all: DropEntry[] = []
    for (;;) {
        const batch = await new Promise<DropEntry[]>((resolve) => {
            reader.readEntries(
                (entries) => resolve(entries ?? []),
                () => resolve([]),
            )
        })
        if (!batch.length) return all
        all.push(...batch)
    }
}

/**
 * Flatten one dropped entry into its files, each tagged with its path relative to the drop target.
 * A file entry yields itself; a directory entry yields its whole subtree under the directory's name.
 * `prefix` is the path already walked (empty at the top level, so a plain file keeps a bare name).
 */
export async function collectDropEntry(entry: DropEntry, prefix = ""): Promise<DroppedFile[]> {
    if (entry.isFile) {
        const file = await entryFile(entry)
        return file ? [{file, relativePath: join(prefix, file.name)}] : []
    }
    if (!entry.isDirectory || !entry.createReader) return []
    const dirPrefix = join(prefix, entry.name)
    const children = await readAllEntries(entry.createReader())
    const collected: DroppedFile[] = []
    for (const child of children) collected.push(...(await collectDropEntry(child, dirPrefix)))
    return collected
}

/**
 * Resolve a drop event to its files. MUST be called synchronously from the drop handler: the
 * `dataTransfer` item list is only alive for the duration of the event, so the entries are taken
 * up front and only the walk itself is async. Falls back to the flat `dataTransfer.files` list where
 * the entries API is unavailable.
 */
export function readDroppedFiles(dataTransfer: DataTransfer | null): Promise<DroppedFile[]> {
    const items = Array.from(dataTransfer?.items ?? []).filter((item) => item.kind === "file")
    if (!items.length) {
        return Promise.resolve(
            Array.from(dataTransfer?.files ?? []).map((file) => ({file, relativePath: file.name})),
        )
    }
    // Both the entry and the plain File are taken here, in the same synchronous pass: an item that
    // has no filesystem entry (a file dragged from another page) still uploads as it always did.
    const picked = items.map((item) => ({
        entry:
            typeof item.webkitGetAsEntry === "function"
                ? (item.webkitGetAsEntry() as DropEntry | null)
                : null,
        file: item.getAsFile(),
    }))
    return Promise.all(
        picked.map(({entry, file}) =>
            entry
                ? collectDropEntry(entry)
                : Promise.resolve(file ? [{file, relativePath: file.name}] : []),
        ),
    ).then((lists) => lists.flat())
}
