/**
 * Safety guard: test code truncates and migrates its database, so refuse to
 * touch anything whose database name does not end in "_test".
 */
export function assertTestDatabaseUrl(url: string): void {
  let dbName: string;
  try {
    // URL strips the query string for us; pathname is "/<database>".
    dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("Refusing to run tests: database URL is not a valid URL");
  }
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against database "${dbName}": the name must end in "_test"`,
    );
  }
}
