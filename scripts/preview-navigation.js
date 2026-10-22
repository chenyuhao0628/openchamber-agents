// Match the installed 2.4.0 host: a valid id is acknowledged even without a directory.
// Only registered targets can render in this fixture; an arbitrary id must not pass QA.
export function navigationResult(surfaceId, directory) {
  if (surfaceId !== 'plugin:agents-manager') return 'unknown';
  return directory?.trim() ? 'open' : 'ignored';
}
