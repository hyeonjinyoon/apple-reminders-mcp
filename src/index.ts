import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runAppleScript, escapeForAppleScript } from "./applescript.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = new McpServer({
  name: "reminders-mcp-server",
  version: "1.0.0",
});

// ─── Helpers ──────────────────────────────────────────────

/** Parse AppleScript's comma-separated list output into an array */
function parseList(raw: string): string[] {
  if (!raw || raw === "missing value") return [];
  // AppleScript returns: item1, item2, item3
  return raw.split(", ").map((s) => s.trim()).filter(Boolean);
}

/** Parse AppleScript date string to ISO */
function parseDate(raw: string): string | null {
  if (!raw || raw === "missing value") return null;
  try {
    return new Date(raw).toISOString();
  } catch {
    return raw; // return raw string if parsing fails
  }
}

// ─── Tools ────────────────────────────────────────────────

// 1. List all reminder lists
server.registerTool(
  "reminders_list_lists",
  {
    title: "List Reminder Lists",
    description: `List all reminder lists (folders) in macOS Reminders.
Returns the name and id of each list.

Returns:
  Array of { name: string, id: string }`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const namesRaw = await runAppleScript(
      'tell application "Reminders" to get name of every list'
    );
    const idsRaw = await runAppleScript(
      'tell application "Reminders" to get id of every list'
    );
    const names = parseList(namesRaw);
    const ids = parseList(idsRaw);

    const lists = names.map((name, i) => ({
      name,
      id: ids[i] ?? "",
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(lists, null, 2) }],
    };
  }
);

// 2. List reminders in a specific list
server.registerTool(
  "reminders_list_items",
  {
    title: "List Reminders",
    description: `List reminders in a specific list.

Args:
  - list_name (string): Name of the reminder list
  - include_completed (boolean): Whether to include completed items (default: false)

Returns:
  Array of { name, id, completed, due_date, priority, body, flagged }`,
    inputSchema: {
      list_name: z.string().describe("Name of the reminder list"),
      include_completed: z
        .boolean()
        .default(false)
        .describe("Include completed reminders"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ list_name, include_completed }) => {
    const escaped = escapeForAppleScript(list_name);
    // Single-query approach to avoid comma-in-name parsing issues.
    // Previously each property was fetched separately and joined by index,
    // but AppleScript's comma-separated list output breaks when names contain commas.
    const reminderSource = include_completed
      ? `every reminder in list "${escaped}"`
      : `every reminder in list "${escaped}" whose completed is false`;

    const script = `
tell application "Reminders"
  set output to ""
  repeat with r in (${reminderSource})
    set rName to name of r
    set rId to id of r
    set rDone to completed of r
    try
      set rDue to due date of r
    on error
      set rDue to "missing value"
    end try
    try
      set rPri to priority of r
    on error
      set rPri to 0
    end try
    try
      set rBody to body of r
    on error
      set rBody to "missing value"
    end try
    try
      set rFlag to flagged of r
    on error
      set rFlag to false
    end try
    set output to output & rName & "\\t" & rId & "\\t" & rDone & "\\t" & rDue & "\\t" & rPri & "\\t" & rBody & "\\t" & rFlag & "\\n"
  end repeat
  return output
end tell`;

    const raw = await runAppleScript(script);
    if (!raw) {
      return {
        content: [{ type: "text", text: JSON.stringify([], null, 2) }],
      };
    }

    const items = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, id, completed, due_date, priority, body, flagged] = line.split("\t");
        return {
          name: name ?? "",
          id: id ?? "",
          completed: completed === "true",
          due_date: parseDate(due_date ?? ""),
          priority: parseInt(priority ?? "0", 10),
          body: body === "missing value" ? null : (body ?? null),
          flagged: flagged === "true",
        };
      });

    return {
      content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
    };
  }
);

// 3. Create a reminder
server.registerTool(
  "reminders_create",
  {
    title: "Create Reminder",
    description: `Create a new reminder in a specific list.

Args:
  - list_name (string): Target reminder list name
  - name (string): Reminder title
  - body (string, optional): Reminder notes/body
  - due_date (string, optional): Due date in ISO 8601 format (e.g. "2025-03-15T09:00:00")
  - priority (number, optional): 0=none, 1=high, 5=medium, 9=low
  - flagged (boolean, optional): Whether to flag the reminder
  - recurrence (string, optional): Recurrence frequency — "daily", "weekly", "monthly", or "yearly"

Returns:
  { id, name, list_name }`,
    inputSchema: {
      list_name: z.string().describe("Target reminder list name"),
      name: z.string().min(1).describe("Reminder title"),
      body: z.string().optional().describe("Reminder notes"),
      due_date: z
        .string()
        .optional()
        .describe("Due date in ISO 8601 (e.g. 2025-03-15T09:00:00)"),
      priority: z
        .number()
        .int()
        .min(0)
        .max(9)
        .optional()
        .describe("0=none, 1=high, 5=medium, 9=low"),
      flagged: z.boolean().optional().describe("Flag this reminder"),
      recurrence: z
        .enum(["daily", "weekly", "monthly", "yearly"])
        .optional()
        .describe("Recurrence frequency: daily, weekly, monthly, or yearly"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ list_name, name, body, due_date, priority, flagged, recurrence }) => {
    // Use Swift/EventKit binary when recurrence is set (AppleScript doesn't support recurrence)
    if (recurrence) {
      try {
        const bin = path.join(__dirname, "reminders-create-recurring");
        const params = JSON.stringify({
          list_name,
          name,
          ...(body !== undefined && { body }),
          ...(due_date !== undefined && { due_date }),
          ...(priority !== undefined && { priority }),
          ...(flagged !== undefined && { flagged }),
          recurrence,
        });
        const { stdout } = await execFileAsync(bin, [params], {
          timeout: 15_000,
        });
        const result = JSON.parse(stdout.trim());
        if (result.error) {
          return {
            content: [
              { type: "text", text: JSON.stringify({ error: result.error }, null, 2) },
            ],
          };
        }
        return {
          content: [
            { type: "text", text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: message }, null, 2) },
          ],
        };
      }
    }

    // Non-recurring: use AppleScript (existing logic)
    const listEsc = escapeForAppleScript(list_name);
    const nameEsc = escapeForAppleScript(name);

    // Build property list
    const props: string[] = [`name:"${nameEsc}"`];
    if (body !== undefined) {
      props.push(`body:"${escapeForAppleScript(body)}"`);
    }
    if (priority !== undefined) {
      props.push(`priority:${priority}`);
    }
    if (flagged !== undefined) {
      props.push(`flagged:${flagged}`);
    }

    let script: string;
    if (due_date) {
      // AppleScript needs date conversion
      script = `
tell application "Reminders"
  set dueDate to current date
  set year of dueDate to ${new Date(due_date).getFullYear()}
  set month of dueDate to ${new Date(due_date).getMonth() + 1}
  set day of dueDate to ${new Date(due_date).getDate()}
  set hours of dueDate to ${new Date(due_date).getHours()}
  set minutes of dueDate to ${new Date(due_date).getMinutes()}
  set seconds of dueDate to 0
  set newReminder to make new reminder in list "${listEsc}" with properties {${props.join(", ")}, due date:dueDate}
  return id of newReminder
end tell`;
    } else {
      script = `tell application "Reminders" to return id of (make new reminder in list "${listEsc}" with properties {${props.join(", ")}})`;
    }

    const id = await runAppleScript(script);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ id: id.trim(), name, list_name }, null, 2),
        },
      ],
    };
  }
);

// 4. Complete a reminder
server.registerTool(
  "reminders_complete",
  {
    title: "Complete Reminder",
    description: `Mark a reminder as completed.

Args:
  - list_name (string): Reminder list name
  - reminder_name (string): Name of the reminder to complete

Returns:
  { success: boolean, name: string }`,
    inputSchema: {
      list_name: z.string().describe("Reminder list name"),
      reminder_name: z.string().describe("Name of the reminder to complete"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ list_name, reminder_name }) => {
    try {
      // Use Swift/EventKit binary — AppleScript `set completed` is broken on macOS 26
      const bin = path.join(__dirname, "reminders-complete");
      const { stdout } = await execFileAsync(bin, [list_name, reminder_name], {
        timeout: 15_000,
      });
      const result = JSON.parse(stdout.trim());
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { success: false, name: reminder_name, error: message },
              null,
              2
            ),
          },
        ],
      };
    }
  }
);

// 5. Delete a reminder
server.registerTool(
  "reminders_delete",
  {
    title: "Delete Reminder",
    description: `Delete a reminder from a list.

Args:
  - list_name (string): Reminder list name
  - reminder_name (string): Name of the reminder to delete

Returns:
  { success: boolean, deleted: string }`,
    inputSchema: {
      list_name: z.string().describe("Reminder list name"),
      reminder_name: z.string().describe("Name of the reminder to delete"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ list_name, reminder_name }) => {
    const listEsc = escapeForAppleScript(list_name);
    const nameEsc = escapeForAppleScript(reminder_name);

    try {
      await runAppleScript(
        `tell application "Reminders" to delete (first reminder in list "${listEsc}" whose name is "${nameEsc}")`
      );

      // Verify deletion — if the reminder still exists, deletion failed
      try {
        await runAppleScript(
          `tell application "Reminders" to get name of (first reminder in list "${listEsc}" whose name is "${nameEsc}")`
        );
        // If we reach here, the reminder still exists
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { success: false, deleted: reminder_name, error: "Reminder still exists after deletion" },
                null,
                2
              ),
            },
          ],
        };
      } catch {
        // Expected — reminder not found means deletion succeeded
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { success: true, deleted: reminder_name },
                null,
                2
              ),
            },
          ],
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { success: false, deleted: reminder_name, error: message },
              null,
              2
            ),
          },
        ],
      };
    }
  }
);

// 6. Search reminders across all lists
server.registerTool(
  "reminders_search",
  {
    title: "Search Reminders",
    description: `Search for reminders by keyword across all lists.

Args:
  - query (string): Search keyword (case-insensitive, matches name and body)
  - include_completed (boolean): Include completed reminders (default: false)

Returns:
  Array of { name, list_name, id, completed, due_date }`,
    inputSchema: {
      query: z.string().min(1).describe("Search keyword"),
      include_completed: z
        .boolean()
        .default(false)
        .describe("Include completed reminders"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ query, include_completed }) => {
    const queryEsc = escapeForAppleScript(query);
    const filter = include_completed ? "" : " and completed is false";

    // JXA (JavaScript for Automation) is more flexible for searching
    const script = `
tell application "Reminders"
  set output to ""
  repeat with aList in every list
    set listName to name of aList
    repeat with r in (every reminder in aList whose name contains "${queryEsc}"${filter})
      set rName to name of r
      set rId to id of r
      set rDone to completed of r
      try
        set rDue to due date of r
      on error
        set rDue to "missing value"
      end try
      set output to output & listName & "\\t" & rName & "\\t" & rId & "\\t" & rDone & "\\t" & rDue & "\\n"
    end repeat
  end repeat
  return output
end tell`;

    const raw = await runAppleScript(script);
    if (!raw) {
      return {
        content: [{ type: "text", text: JSON.stringify([], null, 2) }],
      };
    }

    const results = raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [list_name, name, id, completed, due_date] = line.split("\t");
        return {
          name: name ?? "",
          list_name: list_name ?? "",
          id: id ?? "",
          completed: completed === "true",
          due_date: parseDate(due_date ?? ""),
        };
      });

    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ─── Start Server ─────────────────────────────────────────

async function main(): Promise<void> {
  const mode = process.env.TRANSPORT ?? "stdio";

  if (mode === "http") {
    const app = express();
    app.use(express.json());

    app.post("/mcp", async (req, res) => {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    const port = parseInt(process.env.PORT ?? "9820");
    app.listen(port, "127.0.0.1", () => {
      console.error(`reminders-mcp-server HTTP on :${port}/mcp`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("reminders-mcp-server running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
