import SwiftUI
import AppKit

@main
struct GeniuzApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    // Menu-bar-only app: no Scenes. The status item is created in
    // AppDelegate.applicationDidFinishLaunching. Returning an empty
    // `Settings` scene would add an empty "Preferences..." menu item;
    // returning no scenes at all gives us the clean menu-bar-only UX.
    var body: some Scene {
        Settings {
            EmptyView()
        }
        .commands {
            // Remove default "Preferences..." from the app menu; we have
            // no settings surface yet. Re-adding when real settings exist.
            CommandGroup(replacing: .appSettings) {}
            // Remove Help menu entirely; "Help isn't available for Geniuz"
            // is worse than no Help menu. Re-add when a Help Book exists.
            CommandGroup(replacing: .help) {}
        }
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var popover: NSPopover!
    var service: GeniuzService!

    func applicationDidFinishLaunching(_ notification: Notification) {
        service = GeniuzService()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.image = NSImage(named: "MenuBarIcon")
            button.image?.size = NSSize(width: 18, height: 18)
            button.image?.isTemplate = true
            button.action = #selector(togglePopover)
            button.target = self
        }

        popover = NSPopover()
        popover.contentSize = NSSize(width: 280, height: 320)
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: GeniuzMenu(service: service))
    }

    @objc func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            service.refresh()
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        }
    }
}
