/**
 * Process-wide warning sink for kernel-level diagnostics.
 *
 * The kernel's selector engine has no channel back to the CLI, and Python
 * uses the stdlib `warnings` module for the same purpose; this module is the
 * TS analogue. The CLI drains the sink after a run and turns entries into
 * diagnostics (and failures under --strict).
 */

const _warnings: string[] = [];

export function pushWarning(message: string): void {
  _warnings.push(message);
}

/** Return all recorded warnings and clear the sink. */
export function drainWarnings(): string[] {
  return _warnings.splice(0, _warnings.length);
}
