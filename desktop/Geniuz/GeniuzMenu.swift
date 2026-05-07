import SwiftUI

struct GeniuzMenu: View {
    @ObservedObject var service: GeniuzService

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack(spacing: 8) {
                Text("Geniuz")
                    .font(.headline)
                Spacer()
                Text("v\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0")")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Button(action: { service.openSettings() }) {
                    Image(systemName: "gearshape")
                        .font(.system(size: 13))
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .help("Settings")
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 8)

            Divider()

            // Status
            VStack(alignment: .leading, spacing: 6) {
                if service.stationExists {
                    HStack(spacing: 6) {
                        Image(systemName: "circle.fill")
                            .font(.system(size: 6))
                            .foregroundColor(.green)
                        Text("\(service.memoryCount) memories")
                            .font(.system(.body, design: .rounded))
                    }

                    if !service.recentGists.isEmpty && service.settings.recentMemoriesCount > 0 {
                        recentMemoriesSection
                            .padding(.top, 6)
                    }
                } else {
                    HStack(spacing: 6) {
                        Image(systemName: "circle.fill")
                            .font(.system(size: 6))
                            .foregroundColor(.secondary)
                        Text("No memories yet")
                            .foregroundColor(.secondary)
                    }
                    Text("Start a conversation in Claude Desktop. Say something worth remembering.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.top, 2)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            Divider()

            // Claude Desktop status
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: service.mcpInstalled ? "checkmark.circle.fill" : "xmark.circle")
                        .foregroundColor(service.mcpInstalled ? .green : .orange)
                    Text(service.mcpInstalled ? "Claude Desktop connected" : "Claude Desktop not configured")
                        .font(.caption)
                }

                if !service.mcpInstalled {
                    Button("Configure Claude Connection") {
                        service.configureClaudeConnection()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .tint(.orange)
                }

                if service.mcpInstalled && service.restartRequired {
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.yellow)
                            .font(.caption)
                        Text("Restart Claude Desktop to activate Geniuz.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 2)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            if !service.cliOnPath {
                Divider()
                cliInstallSection
            }

            Divider()

            Button(action: { NSApplication.shared.terminate(nil) }) {
                Label("Quit Geniuz", systemImage: "power")
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .padding(.bottom, 4)
        }
        .frame(width: 280)
        .background(.regularMaterial)
    }

    // MARK: - CLI install section

    private var cliInstallSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "terminal")
                    .foregroundColor(.secondary)
                    .font(.caption)
                Text("Use Geniuz from Terminal")
                    .font(.caption)
            }

            if service.cliCopyConfirmation {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                        .font(.caption)
                    Text("Command copied — paste into Terminal and press Return.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 2)
            } else {
                Button("Copy Install Command") {
                    service.copyCliInstallCommand()
                }
                .buttonStyle(.bordered)
                .controlSize(.small)

                Text("Copies a one-line `sudo` command. Paste into Terminal to add `geniuz` to your PATH.")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: - Recent memories section

    private var recentMemoriesSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button(action: {
                withAnimation(.easeInOut(duration: 0.15)) {
                    service.recentExpanded.toggle()
                }
            }) {
                HStack(spacing: 4) {
                    Text("RECENT MEMORIES")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .textCase(.uppercase)
                    Spacer()
                    Image(systemName: service.recentExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundColor(.secondary)
                }
            }
            .buttonStyle(.plain)

            // Settings can hide the section entirely (count = 0) or cap how
            // many gists appear when expanded. Collapsed view always shows
            // at most 1 to keep the menubar height small; if the user set
            // count = 0, both modes show 0.
            let count = max(0, service.settings.recentMemoriesCount)
            let visible = service.recentExpanded
                ? Array(service.recentGists.prefix(count))
                : Array(service.recentGists.prefix(min(1, count)))

            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(visible.enumerated()), id: \.offset) { _, gist in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "circle.fill")
                            .font(.system(size: 4))
                            .foregroundColor(.secondary)
                            .padding(.top, 5)
                        Text(gist)
                            .font(.caption)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

// MARK: - Settings window
//
// Opened via the gear icon in the GeniuzMenu header. Save-on-change UX
// (Mac convention) — every Toggle/Picker/Stepper writes through to
// settings.json on the spot, no Apply/Cancel buttons. The window is
// reused across opens; closing just hides it.
//
// Platform-side enforcement (LaunchAgent for launch_at_login, Sparkle
// for autoupdate) is wired up in subsequent commits — for now the JSON
// is the truth and a future reconciliation pass will sync the
// LaunchAgent / Sparkle preference state to match.

struct GeniuzSettingsView: View {
    @ObservedObject var service: GeniuzService

    var body: some View {
        Form {
            Section("General") {
                Toggle("Launch at login", isOn: launchAtLoginBinding)
                Toggle("Check for updates automatically", isOn: autoupdateBinding)
                Picker("Update frequency", selection: frequencyBinding) {
                    Text("Daily").tag("daily")
                    Text("Weekly").tag("weekly")
                    Text("Manually only").tag("manual")
                }
                .disabled(!service.settings.autoupdateEnabled)
            }

            Section("Display") {
                Stepper(
                    "Recent memories shown: \(service.settings.recentMemoriesCount)",
                    value: recentCountBinding,
                    in: 0...20
                )
                Text("Set to 0 to hide the recent memories section in the menu.")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Section("Storage") {
                LabeledContent("Folder") {
                    Text(service.dataDir)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                        .multilineTextAlignment(.trailing)
                }
                Text("Override by setting GENIUZ_HOME in your shell profile, then restart Geniuz.")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            Section("About") {
                LabeledContent("Version") {
                    Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?")
                        .font(.system(.caption, design: .monospaced))
                }
            }
        }
        .formStyle(.grouped)
        .padding(0)
        // minWidth/minHeight (not fixed frame) so the NSWindow's resizable
        // styleMask can actually grow the content. The window's setContentSize
        // dictates the initial frame; this binds the floor.
        .frame(minWidth: 380, minHeight: 320)
    }

    // MARK: - Save-on-change bindings

    private var launchAtLoginBinding: Binding<Bool> {
        Binding(
            get: { service.settings.launchAtLogin },
            set: { v in service.updateSettings { $0.launchAtLogin = v } }
        )
    }

    private var autoupdateBinding: Binding<Bool> {
        Binding(
            get: { service.settings.autoupdateEnabled },
            set: { v in service.updateSettings { $0.autoupdateEnabled = v } }
        )
    }

    private var frequencyBinding: Binding<String> {
        Binding(
            get: { service.settings.updateCheckFrequency },
            set: { v in service.updateSettings { $0.updateCheckFrequency = v } }
        )
    }

    private var recentCountBinding: Binding<Int> {
        Binding(
            get: { service.settings.recentMemoriesCount },
            set: { v in service.updateSettings { $0.recentMemoriesCount = v } }
        )
    }
}
