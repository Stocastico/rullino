/**
 * An edit document (or a part of one) that cannot be read: thrown by `parseEdit`, `parseChain` and
 * `migrateEdit` for anything wrong with the document, with a message that says where. Any other
 * error from them is a bug in rullino, not in the document.
 */
export class ParseError extends Error {
  override readonly name = 'ParseError';
}

/** Runs `check` (a validator that throws plain errors) and rethrows what it throws as a ParseError, prefixed with `where` if given. */
export function asParseError<T>(where: string, check: () => T): T {
  try {
    return check();
  } catch (e) {
    if (e instanceof ParseError) throw e;
    throw new ParseError(where ? `${where}: ${(e as Error).message}` : (e as Error).message);
  }
}
