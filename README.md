# apple-reminders-mcp

An MCP server that lets you manage macOS iCloud Reminders from Claude Code.
It accesses Reminders.app via AppleScript and EventKit.

## Tools

| Tool | Description |
|------|-------------|
| `reminders_list_lists` | List all reminder lists |
| `reminders_list_items` | List reminders in a specific list |
| `reminders_create` | Create a reminder (due date, priority, flag, recurrence) |
| `reminders_complete` | Mark a reminder as completed |
| `reminders_delete` | Delete a reminder |
| `reminders_search` | Search reminders by keyword across all lists |

## Installation

```bash
cd reminders-mcp-server
npm install
npm run build
```

## macOS Permissions

On first run, a dialog will appear requesting access to Reminders.app.
You must allow it for the server to work.

To configure manually:
**System Settings → Privacy & Security → Automation** — allow the calling process (Terminal or Node) to access **Reminders**.

## Claude Code Configuration

Add to `~/.claude/claude_code_config.json` or your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "reminders": {
      "command": "node",
      "args": ["/absolute/path/to/reminders-mcp-server/dist/index.js"]
    }
  }
}
```

For example, if installed in your home directory:

```json
{
  "mcpServers": {
    "reminders": {
      "command": "node",
      "args": ["/Users/yourname/reminders-mcp-server/dist/index.js"]
    }
  }
}
```

## Usage Examples

In Claude Code:

- "Show my reminder lists"
- "List incomplete items in the 'Tasks' list"
- "Add 'Buy milk' to 'Tasks', due tomorrow"
- "Mark 'Buy milk' as completed"
- "Search reminders for 'meeting'"

## Notes

- macOS only (depends on AppleScript and EventKit)
- If Reminders.app is connected to iCloud, iCloud reminders are also accessible
- Lists with many reminders may be slow to query
- Subtasks are not supported due to AppleScript limitations
