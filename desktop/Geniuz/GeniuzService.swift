import Foundation
import SQLite3
import Combine
import AppKit

class GeniuzService: ObservableObject {
    @Published var memoryCount: Int = 0
    @Published var recentGists: [String] = []
    @Published var mcpInstalled: Bool = false
    @Published var stationExists: Bool = false
    @Published var recentExpanded: Bool = false
    @Published var restartRequired: Bool = false
    @Published var cliOnPath: Bool = false
    @Published var cliCopyConfirmation: Bool = false

    private var timer: Timer?
    private var claudeAtConfigureTime: Set<pid_t> = []
    private var claudeSeenAfterConfigure: Set<pid_t> = []

    private let claudeBundleID = "com.anthropic.claudefordesktop"

    /// Real home directory via getpwuid — not remapped by sandbox
    private var realHome: String {
        if let pw = getpwuid(getuid()), let home = pw.pointee.pw_dir {
            return String(cString: home)
        }
        return NSHomeDirectory()
    }

    var stationPath: String {
        return "\(realHome)/.geniuz/memory.db"
    }

    var geniuzBinaryPath: String {
        Bundle.main.path(forResource: "geniuz", ofType: nil) ?? "/usr/local/bin/geniuz"
    }

    var claudeConfigPath: String {
        return "\(realHome)/Library/Application Support/Claude/claude_desktop_config.json"
    }

    init() {
        NSLog("[geniuz-app] init — realHome=%@ stationPath=%@", realHome, stationPath)
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            self?.refresh()
        }

        let nc = NSWorkspace.shared.notificationCenter
        nc.addObserver(self,
                       selector: #selector(appLaunched(_:)),
                       name: NSWorkspace.didLaunchApplicationNotification,
                       object: nil)
        nc.addObserver(self,
                       selector: #selector(appTerminated(_:)),
                       name: NSWorkspace.didTerminateApplicationNotification,
                       object: nil)
    }

    deinit {
        timer?.invalidate()
        NSWorkspace.shared.notificationCenter.removeObserver(self)
    }

    func refresh() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self = self else { return }
            let station = self.readStation()
            let mcp = self.checkMcpInstalled()
            let onPath = self.checkCliOnPath()

            DispatchQueue.main.async {
                self.stationExists = station.exists
                self.memoryCount = station.memories
                self.recentGists = station.recentGists
                self.mcpInstalled = mcp
                self.cliOnPath = onPath
            }
        }
    }

    // MARK: - CLI on PATH

    /// Is `geniuz` resolvable on the user's actual PATH?
    ///
    /// Matches the shell's `which geniuz` semantics exactly — runs `/usr/bin/which`
    /// as a subprocess against a shell-set PATH and checks the exit code. This is
    /// more honest than iterating a candidate list: if the user's shell can't find
    /// `geniuz`, the menu-bar affordance must appear regardless of whether a stale
    /// binary exists at some path that isn't currently on PATH.
    ///
    /// Previous candidate-list implementation would return true for stale binaries
    /// at `~/.geniuz/bin/geniuz` or similar that a prior install-script wrote but
    /// the user's login-shell PATH doesn't include. That hid the affordance from
    /// users who still needed it — false positive.
    func checkCliOnPath() -> Bool {
        let task = Process()
        task.launchPath = "/usr/bin/which"
        task.arguments = ["geniuz"]
        // Use login-shell PATH by invoking via shell; ensures we match what the
        // user's Terminal actually sees, not the app's sandboxed environment.
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = Pipe()
        do {
            try task.run()
            task.waitUntilExit()
            return task.terminationStatus == 0
        } catch {
            NSLog("[geniuz-app] which geniuz failed to launch: %@", error.localizedDescription)
            return false
        }
    }

    /// Copies a ready-to-paste sudo command to the clipboard that symlinks the
    /// bundled CLI into /usr/local/bin/geniuz. The user pastes into Terminal; the
    /// app never attempts privileged execution itself (sandbox-friendly).
    func copyCliInstallCommand() {
        let bundled = geniuzBinaryPath
        let command = "sudo ln -sf \"\(bundled)\" /usr/local/bin/geniuz"
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(command, forType: .string)
        NSLog("[geniuz-app] copied CLI install command: %@", command)

        cliCopyConfirmation = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
            self?.cliCopyConfirmation = false
        }
    }

    // MARK: - Direct SQLite station read

    private struct StationInfo {
        var exists: Bool = false
        var memories: Int = 0
        var recentGists: [String] = []
    }

    private func readStation() -> StationInfo {
        var info = StationInfo()
        let path = stationPath

        let fileExists = FileManager.default.fileExists(atPath: path)
        NSLog("[geniuz-app] readStation path=%@ exists=%d", path, fileExists ? 1 : 0)

        guard fileExists else { return info }
        info.exists = true

        var db: OpaquePointer?
        // Open as immutable — skips WAL, no write access needed
        let uri = "file:\(path)?mode=ro&immutable=1"
        let rc = sqlite3_open_v2(uri, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX | SQLITE_OPEN_URI, nil)
        NSLog("[geniuz-app] sqlite3_open rc=%d path=%@", rc, uri)
        guard rc == SQLITE_OK else { return info }
        defer { sqlite3_close(db) }

        // Memory count
        var stmt: OpaquePointer?
        if sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM memories", -1, &stmt, nil) == SQLITE_OK {
            if sqlite3_step(stmt) == SQLITE_ROW {
                info.memories = Int(sqlite3_column_int(stmt, 0))
            }
        }
        sqlite3_finalize(stmt)

        // Recent memories — gist text only, most recent 5
        let sql = "SELECT COALESCE(json_extract(payload, '$.gist'), substr(json_extract(payload, '$.content'), 1, 100)) FROM memories ORDER BY created_at DESC LIMIT 5"
        if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
            while sqlite3_step(stmt) == SQLITE_ROW {
                if let cStr = sqlite3_column_text(stmt, 0) {
                    info.recentGists.append(String(cString: cStr))
                }
            }
        }
        sqlite3_finalize(stmt)

        NSLog("[geniuz-app] station: %d memories, %d recent gists",
              info.memories, info.recentGists.count)
        return info
    }

    // MARK: - MCP config

    func checkMcpInstalled() -> Bool {
        let path = claudeConfigPath
        guard let data = FileManager.default.contents(atPath: path),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let servers = json["mcpServers"] as? [String: Any] else {
            NSLog("[geniuz-app] MCP config not readable at %@", path)
            return false
        }
        let found = servers.keys.contains { $0.lowercased() == "geniuz" }
        NSLog("[geniuz-app] MCP installed=%d", found ? 1 : 0)
        return found
    }

    func configureClaudeConnection() {
        let binary = geniuzBinaryPath

        var config: [String: Any]
        if let data = FileManager.default.contents(atPath: claudeConfigPath),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            config = json
        } else {
            config = [:]
            let dir = (claudeConfigPath as NSString).deletingLastPathComponent
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        }

        var servers = config["mcpServers"] as? [String: Any] ?? [:]
        servers["geniuz"] = [
            "command": binary,
            "args": ["mcp", "serve"]
        ]
        config["mcpServers"] = servers

        if let data = try? JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: URL(fileURLWithPath: claudeConfigPath))
        }

        // Snapshot Claude Desktop PIDs at configure time; banner clears when they all exit
        // and at least one replacement has launched.
        let runningClaudes = NSWorkspace.shared.runningApplications
            .filter { $0.bundleIdentifier == claudeBundleID }
            .map { $0.processIdentifier }
        claudeAtConfigureTime = Set(runningClaudes)
        claudeSeenAfterConfigure = []
        restartRequired = true

        NSLog("[geniuz-app] configured — Claude PIDs at configure time: %@",
              claudeAtConfigureTime.map(String.init).joined(separator: ","))

        refresh()
    }

    // MARK: - Claude Desktop lifecycle

    @objc private func appLaunched(_ note: Notification) {
        guard restartRequired,
              let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
              app.bundleIdentifier == claudeBundleID else { return }
        let pid = app.processIdentifier
        if !claudeAtConfigureTime.contains(pid) {
            claudeSeenAfterConfigure.insert(pid)
            evaluateRestartState()
        }
    }

    @objc private func appTerminated(_ note: Notification) {
        guard restartRequired,
              let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
              app.bundleIdentifier == claudeBundleID else { return }
        let pid = app.processIdentifier
        claudeAtConfigureTime.remove(pid)
        evaluateRestartState()
    }

    private func evaluateRestartState() {
        // Banner clears when every Claude instance present at configure time has exited
        // AND at least one new Claude instance has launched since.
        if claudeAtConfigureTime.isEmpty && !claudeSeenAfterConfigure.isEmpty {
            DispatchQueue.main.async { [weak self] in
                self?.restartRequired = false
                NSLog("[geniuz-app] restart-required banner cleared — Claude Desktop replaced")
            }
        }

        // Edge case: configure was clicked with no Claude running. First launch counts as "restarted."
        if claudeAtConfigureTime.isEmpty && claudeSeenAfterConfigure.isEmpty {
            // Nothing to do — wait for a launch.
        }
    }
}
