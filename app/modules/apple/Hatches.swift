// Notient's native module on Apple: its access hatches (written by hand in the shape `exact hatch` stubs:
// this app has no apple/ directory, so the verb refuses). Documentation: documentation/frontend/pages/notes/rich-text.md
// ("Native format bar (iOS)"). iOS only; app.json hatches: {"formatbar": ["ios"]}.
#if os(iOS)
import UIKit

final class AppHatches: ExactModule {
    override func element(_ element: ExactElement) {
        if element.hatch == .formatbar { formatbarHatch(element) }
        if element.hatch == .ai { aiHatch(element) }
    }

    override func elementEnded(_ element: ExactElement) {
        if element.hatch == .formatbar { formatbarHatchEnded(element) }
    }
}

let exactModule: ExactModule.Type = AppHatches.self
#elseif os(macOS)
// On the Mac only the "ai" hatch applies (the format bar is iOS's).
final class AppHatches: ExactModule {
    override func element(_ element: ExactElement) {
        if element.hatch == .ai { aiHatch(element) }
    }
}

let exactModule: ExactModule.Type = AppHatches.self
#else
final class AppHatches: ExactModule {}

let exactModule: ExactModule.Type = AppHatches.self
#endif
