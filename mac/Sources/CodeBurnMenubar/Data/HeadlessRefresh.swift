import Foundation

// Runs one CLI fetch and writes menubar-status.json, then exits. Invoked by the
// LaunchAgent via the app's own signed binary so the spawned CLI inherits
// CodeBurn's TCC grant instead of prompting as a bare `node` process.
enum HeadlessRefresh {
    // The semaphore provides the happens-before edge between the Task's write and
    // the synchronous read below, so this single-slot box is safe to share.
    private final class ExitBox: @unchecked Sendable {
        var code: Int32 = 1
    }

    static func run() -> Never {
        let semaphore = DispatchSemaphore(value: 0)
        let box = ExitBox()
        Task {
            do {
                // Same bundle ID as the GUI app, so .standard is its own domain.
                let period = Period.savedMenubarPeriod()
                let payload = try await DataClient.fetch(period: period, provider: .all, includeOptimize: false)
                try MenubarStatusCache.standard().writeStatus(payload)
                box.code = 0
            } catch {
                FileHandle.standardError.write(Data("CodeBurn refresh-once failed: \(error)\n".utf8))
            }
            semaphore.signal()
        }
        semaphore.wait()
        exit(box.code)
    }
}
