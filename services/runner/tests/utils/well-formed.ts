/**
 * `String.prototype.isWellFormed` (Node 20+). The runner's tsconfig lib is ES2023, which does
 * not declare it, so the tests reach it through this one typed call.
 */
export function isWellFormed(text: string): boolean {
  return (text as string & { isWellFormed(): boolean }).isWellFormed();
}
