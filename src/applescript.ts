import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Execute an AppleScript string and return stdout.
 * Throws on non-zero exit or stderr.
 */
export async function runAppleScript(script: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", script], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    const msg = error.stderr?.trim() || error.message || "Unknown AppleScript error";
    throw new Error(`AppleScript failed: ${msg}`);
  }
}

/**
 * Execute a multi-line AppleScript (passed as separate -e args).
 */
export async function runAppleScriptLines(lines: string[]): Promise<string> {
  const args: string[] = [];
  for (const line of lines) {
    args.push("-e", line);
  }
  try {
    const { stdout } = await execFileAsync("osascript", args, {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    const msg = error.stderr?.trim() || error.message || "Unknown AppleScript error";
    throw new Error(`AppleScript failed: ${msg}`);
  }
}

/**
 * Escape a string for safe inclusion in AppleScript double-quoted strings.
 */
export function escapeForAppleScript(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}
