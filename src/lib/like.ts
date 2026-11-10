/** Escapes LIKE/ILIKE wildcards (`%`, `_`, and the escape character itself) so a user's term is matched literally. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
