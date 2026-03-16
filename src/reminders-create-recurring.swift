import EventKit
import Foundation

// Usage: reminders-create-recurring <json>
// Creates a reminder with optional recurrence using EventKit.
// JSON input: { "list_name", "name", "due_date?" (ISO 8601 local), "recurrence?" (daily|weekly|monthly|yearly), "body?", "priority?", "flagged?" }
// Outputs JSON: { "id", "name", "list_name", "recurrence" } or { "error": "..." }

func escapeJSON(_ s: String) -> String {
    s.replacingOccurrences(of: "\\", with: "\\\\")
     .replacingOccurrences(of: "\"", with: "\\\"")
     .replacingOccurrences(of: "\n", with: "\\n")
     .replacingOccurrences(of: "\t", with: "\\t")
}

func outputJSON(_ dict: [String: Any]) {
    var parts: [String] = []
    for (k, v) in dict {
        switch v {
        case let b as Bool:
            parts.append("\"\(k)\":\(b)")
        case let n as Int:
            parts.append("\"\(k)\":\(n)")
        case let s as String:
            parts.append("\"\(k)\":\"\(escapeJSON(s))\"")
        default:
            parts.append("\"\(k)\":\"\(v)\"")
        }
    }
    print("{\(parts.joined(separator: ","))}")
}

guard CommandLine.arguments.count >= 2 else {
    outputJSON(["error": "Usage: reminders-create-recurring '<json>'"])
    exit(1)
}

let jsonString = CommandLine.arguments[1]
guard let jsonData = jsonString.data(using: .utf8),
      let params = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
    outputJSON(["error": "Invalid JSON input"])
    exit(1)
}

guard let listName = params["list_name"] as? String,
      let name = params["name"] as? String else {
    outputJSON(["error": "list_name and name are required"])
    exit(1)
}

let dueDateStr = params["due_date"] as? String
let recurrenceStr = params["recurrence"] as? String
let body = params["body"] as? String
let priority = params["priority"] as? Int ?? 0
let flagged = params["flagged"] as? Bool ?? false

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)

store.requestFullAccessToReminders { granted, error in
    defer { semaphore.signal() }

    guard granted else {
        let errMsg = error?.localizedDescription ?? "Permission denied"
        outputJSON(["error": errMsg])
        return
    }

    let calendars = store.calendars(for: .reminder)
    guard let calendar = calendars.first(where: { $0.title == listName }) else {
        outputJSON(["error": "List not found: \(listName)"])
        return
    }

    let reminder = EKReminder(eventStore: store)
    reminder.title = name
    reminder.calendar = calendar
    reminder.priority = priority

    if flagged {
        reminder.priority = 1  // flagged maps to high priority in EventKit
    }

    if let body = body {
        reminder.notes = body
    }

    // Parse due date (treated as local time)
    if let dueDateStr = dueDateStr {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        // Try multiple formats
        let formats = [
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm",
            "yyyy-MM-dd"
        ]
        var date: Date?
        for fmt in formats {
            formatter.dateFormat = fmt
            if let d = formatter.date(from: dueDateStr) {
                date = d
                break
            }
        }
        if let date = date {
            let components = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute, .second],
                from: date
            )
            reminder.dueDateComponents = components
            // Also set alarm so notification fires
            reminder.addAlarm(EKAlarm(absoluteDate: date))
        }
    }

    // Set recurrence
    if let recurrenceStr = recurrenceStr {
        let freq: EKRecurrenceFrequency
        switch recurrenceStr.lowercased() {
        case "daily": freq = .daily
        case "weekly": freq = .weekly
        case "monthly": freq = .monthly
        case "yearly": freq = .yearly
        default:
            outputJSON(["error": "Invalid recurrence: \(recurrenceStr). Use daily/weekly/monthly/yearly"])
            return
        }
        let rule = EKRecurrenceRule(recurrenceWith: freq, interval: 1, end: nil)
        reminder.addRecurrenceRule(rule)
    }

    do {
        try store.save(reminder, commit: true)
        outputJSON([
            "id": reminder.calendarItemIdentifier,
            "name": name,
            "list_name": listName,
            "recurrence": recurrenceStr ?? "none"
        ])
    } catch {
        outputJSON(["error": error.localizedDescription])
    }
}

semaphore.wait()
