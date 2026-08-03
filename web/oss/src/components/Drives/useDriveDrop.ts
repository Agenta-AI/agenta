import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type HTMLAttributes,
} from "react"

/**
 * Drag-and-drop upload behaviour shared by the drive's tree and grid: highlight the folder under
 * the cursor, spring-load into it after a short hover (drill to a nested destination without
 * dropping), and upload on drop — into the hovered folder, or the current folder for a background
 * drop. The views wire the returned handler props onto folder targets and their container.
 */

const SPRING_MS = 700

export interface DroppedFileItem {
  file: File;
  relativePath: string;
}

/**
 * Recursively traverses dropped DataTransferItems to extract all files,
 * walking subdirectories using webkitGetAsEntry.
 */
export async function getFilesFromDataTransfer(
  items: DataTransferItemList
): Promise<DroppedFileItem[]> {
  const results: DroppedFileItem[] = [];

  async function traverseEntry(entry: any, path = ""): Promise<void> {
    if (!entry) return;

    if (entry.isFile) {
      await new Promise<void>((resolve) => {
        entry.file(
          (file: File) => {
            const relativePath = path ? `${path}/${file.name}` : file.name;
            try {
              Object.defineProperty(file, "relativePath", {
                value: relativePath,
                writable: true,
                configurable: true,
              });
            } catch {
              // Ignore if property cannot be redefined
            }
            results.push({ file, relativePath });
            resolve();
          },
          () => resolve() // Error callback: resolves gracefully if file read fails
        );
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      let batch: any[] = [];
      do {
        batch = await new Promise<any[]>((resolve) => {
          dirReader.readEntries(
            (entries: any[]) => resolve(entries || []),
            () => resolve([]) // Error callback: resolves with [] if dir read fails
          );
        });

        const folderPath = path ? `${path}/${entry.name}` : entry.name;
        for (const childEntry of batch) {
          await traverseEntry(childEntry, folderPath);
        }
      } while (batch.length > 0);
    }
  }

  const promises: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as any;
    const entry = typeof item?.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    if (entry) {
      promises.push(traverseEntry(entry));
    }
  }

  await Promise.all(promises);
  return results;
}

/**
 * Helper to safely extract files from DataTransfer, returning DroppedFileItem[] with relativePath preserved
 */
async function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer
): Promise<DroppedFileItem[]> {
  if (dataTransfer.items && dataTransfer.items.length > 0) {
    const droppedItems = await getFilesFromDataTransfer(dataTransfer.items);
    if (droppedItems.length > 0) {
      return droppedItems;
    }
  }
  return Array.from(dataTransfer.files ?? []).map((file) => ({
    file,
    relativePath: (file as any).webkitRelativePath || file.name,
  }));
}

export interface DriveDrop {
    /** A file drag is in progress anywhere over the drive (for a subtle drop-affordance). */
    dragging: boolean
    /** Folder path currently hovered as a drop target, or null. */
    hoverPath: string | null
    /** Handlers for a folder drop target — spring-loads into it, uploads on drop. */
    folderDropProps: (path: string) => {
        onDragEnter: (e: DragEvent) => void
        onDragOver: (e: DragEvent) => void
        onDrop: (e: DragEvent) => void
    }
    /** Handlers for the view container — clears the hover, uploads into `currentFolder` on drop. */
    containerDropProps: (currentFolder: string) => {
        onDragEnter: (e: DragEvent) => void
        onDragOver: (e: DragEvent) => void
        onDrop: (e: DragEvent) => void
    }
}

export function useDriveDrop({
    enabled = true,
    onUpload,
    onNavigate,
}: {
    /** False leaves the hook mounted but inert — no window listeners, nothing to hover. */
    enabled?: boolean
    onUpload: (files: File[], folder: string) => void
    onNavigate: (folder: string) => void
}): DriveDrop {
    const [dragging, setDragging] = useState(false)
    const [hoverPath, setHoverPath] = useState<string | null>(null)

    const springTimer = useRef<number | undefined>(undefined)
    const springPath = useRef<string | null>(null)
    const clearSpring = useCallback(() => {
        window.clearTimeout(springTimer.current)
        springTimer.current = undefined
        springPath.current = null
    }, [])

    // Window-level drag tracking for the overall `dragging` flag
    const depth = useRef(0)
    useEffect(() => {
        if (!enabled) return
        const has = (e: globalThis.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files")
        const onEnter = (e: globalThis.DragEvent) => {
            if (has(e)) {
                depth.current += 1
                setDragging(true)
            }
        }
        const onLeave = () => {
            depth.current = Math.max(0, depth.current - 1)
            if (depth.current === 0) setDragging(false)
        }
        const onEnd = () => {
            depth.current = 0
            setDragging(false)
            setHoverPath(null)
            clearSpring()
        }
        window.addEventListener("dragenter", onEnter)
        window.addEventListener("dragleave", onLeave)
        window.addEventListener("drop", onEnd)
        window.addEventListener("dragend", onEnd)
        return () => {
            window.removeEventListener("dragenter", onEnter)
            window.removeEventListener("dragleave", onLeave)
            window.removeEventListener("drop", onEnd)
            window.removeEventListener("dragend", onEnd)
        }
    }, [enabled, clearSpring])

    const startSpring = useCallback(
        (path: string) => {
            if (springPath.current === path) return // already counting down on this folder
            clearSpring()
            springPath.current = path
            springTimer.current = window.setTimeout(() => {
                onNavigate(path)
                clearSpring()
                setHoverPath(null)
            }, SPRING_MS)
        },
        [clearSpring, onNavigate],
    )

    const folderDropProps = useCallback(
        (path: string) => ({
            onDragEnter: (e: DragEvent) => {
                if (!isFileDrag(e)) return
                e.preventDefault()
                e.stopPropagation()
                setHoverPath(path)
                startSpring(path)
            },
            onDragOver: (e: DragEvent) => {
                if (!isFileDrag(e)) return
                e.preventDefault()
                e.stopPropagation()
            },
            onDrop: async (e: DragEvent) => {
                if (!isFileDrag(e)) return
                e.preventDefault()
                e.stopPropagation()
                if (e.dataTransfer) {
                    const files = await extractFilesFromDataTransfer(e.dataTransfer)
                    if (files.length) onUpload(files, path)
                }
                setHoverPath(null)
                clearSpring()
            },
        }),
        [onUpload, startSpring, clearSpring],
    )

    const containerDropProps = useCallback(
        (currentFolder: string) => ({
            onDragEnter: (e: DragEvent) => {
                if (!isFileDrag(e)) return
                setHoverPath(null)
                clearSpring()
            },
            onDragOver: (e: DragEvent) => {
                if (isFileDrag(e)) e.preventDefault()
            },
            onDrop: async (e: DragEvent) => {
                if (!isFileDrag(e)) return
                e.preventDefault()
                if (e.dataTransfer) {
                    const files = await extractFilesFromDataTransfer(e.dataTransfer)
                    if (files.length) onUpload(files, currentFolder)
                }
                setHoverPath(null)
                clearSpring()
            },
        }),
        [onUpload, clearSpring],
    )

    return {dragging, hoverPath, folderDropProps, containerDropProps}
}

/** Handler props for a drop target — the shape both drop hooks hand to a host element. */
export type FileDropProps = Partial<
    Pick<HTMLAttributes<HTMLElement>, "onDragOver" | "onDragLeave" | "onDrop">
>

/**
 * Drop-to-STAGE: the lighter sibling of {@link useDriveDrop}
 */
export function useStageDrop(onFiles: ((files: File[]) => void) | false | null | undefined): {
    dropActive: boolean
    dropProps: FileDropProps
} {
    const [dropActive, setDropActive] = useState(false)
    if (!onFiles) return {dropActive: false, dropProps: {}}
    return {
        dropActive,
        dropProps: {
            onDragOver: (e: DragEvent) => {
                if (!isFileDrag(e)) return
                e.preventDefault()
                setDropActive(true)
            },
            onDragLeave: () => setDropActive(false),
            onDrop: async (e: DragEvent) => {
                if (!isFileDrag(e)) return
                e.preventDefault()
                setDropActive(false)
                if (e.dataTransfer) {
                    const files = await extractFilesFromDataTransfer(e.dataTransfer)
                    if (files.length) onFiles(files)
                }
            },
        },
    }
}