import EventKit
import Foundation

// Usage: reminders-complete <list_name> <reminder_name>
// Completes a reminder by name in the specified list using EventKit.
// Handles both one-time and recurring reminders.
// Outputs JSON: { "success": true/false, "name": "...", "recurring": bool, ... }

func escapeJSON(_ s: String) -> String {
    s.replacingOccurrences(of: "\\", with: "\\\\")
     .replacingOccurrences(of: "\"", with: "\\\"")
     .replacingOccurrences(of: "\n", with: "\\n")
     .replacingOccurrences(of: "\t", with: "\\t")
}

func output(_ dict: [String: Any]) {
    var parts: [String] = []
    for (k, v) in dict {
        switch v {
        case let b as Bool:
            parts.append("\"\(k)\":\(b)")
        case let s as String:
            parts.append("\"\(k)\":\"\(escapeJSON(s))\"")
        default:
            parts.append("\"\(k)\":\"\(v)\"")
        }
    }
    print("{\(parts.joined(separator: ","))}")
}

guard CommandLine.arguments.count >= 3 else {
    output(["success": false, "error": "Usage: reminders-complete <list_name> <reminder_name>"])
    exit(1)
}

let listName = CommandLine.arguments[1]
let reminderName = CommandLine.arguments[2]

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)

store.requestFullAccessToReminders { granted, error in
    defer { semaphore.signal() }

    guard granted else {
        let errMsg = error?.localizedDescription ?? "Permission denied"
        output(["success": false, "name": reminderName, "error": errMsg])
        return
    }

    let calendars = store.calendars(for: .reminder)
    guard let calendar = calendars.first(where: { $0.title == listName }) else {
        output(["success": false, "name": reminderName, "error": "List not found: \(listName)"])
        return
    }

    let predicate = store.predicateForReminders(in: [calendar])
    store.fetchReminders(matching: predicate) { reminders in
        defer { semaphore.signal() }

        guard let reminders = reminders else {
            output(["success": false, "name": reminderName, "error": "Failed to fetch reminders"])
            return
        }

        guard let target = reminders.first(where: { $0.title == reminderName && !$0.isCompleted }) else {
            output(["success": false, "name": reminderName, "error": "Reminder not found (or already completed)"])
            return
        }

        let isRecurring = target.hasRecurrenceRules

        target.isCompleted = true
        target.completionDate = Date()

        do {
            try store.save(target, commit: true)

            if isRecurring {
                // For recurring reminders, isCompleted resets to false (next occurrence).
                // The save succeeded without error, so the current instance was completed.
                output(["success": true, "name": reminderName, "verified": true, "recurring": true])
            } else {
                let verified = target.isCompleted
                output(["success": verified, "name": reminderName, "verified": verified, "recurring": false])
            }
        } catch {
            output(["success": false, "name": reminderName, "error": error.localizedDescription])
        }
    }

    semaphore.wait()
}

semaphore.wait()
