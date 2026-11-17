// The "ai" access hatch: Apple Intelligence (FoundationModels, on device, iOS 26 and macOS 26) for grocery lists.
// Documentation: documentation/frontend/pages/tasks/tasks-board.md ("Apple Intelligence").
// A hidden input in the list screen. On first build it tells the contract its status
// ("ai:ready:<ok|old|ineligible|notenabled|notready>"); a new data-request ("<n>\n<id>\t<title>\n...")
// is put into supermarket departments and answered "ai:sorted:<n>:<Department|id id;Department|id id>" or "ai:error:<n>:<why>".
#if os(iOS) || os(macOS)
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

nonisolated(unsafe) private var lastRequest = ""

func aiHatch(_ element: ExactElement) {
    if element.isNew {
        lastRequest = ""
        element.input("ai:ready:\(aiStatus())")
    }
    let request = element.data[.request] ?? ""
    guard !request.isEmpty, request != lastRequest else { return }
    lastRequest = request
    let lines = request.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    guard let counter = lines.first else { return }
    let items = lines.dropFirst().compactMap { line -> (id: String, title: String)? in
        let parts = line.split(separator: "\t", maxSplits: 1).map(String.init)
        return parts.count == 2 ? (parts[0], parts[1]) : nil
    }
    #if canImport(FoundationModels)
    if #available(iOS 26.0, macOS 26.0, *) {
        Task { @MainActor in
            do {
                let spec = try await sortByAisle(items)
                guard element.isLive else { return }
                element.input("ai:sorted:\(counter):\(spec)")
            } catch {
                let why = String(describing: error).replacingOccurrences(of: "\n", with: " ").prefix(160)
                element.input("ai:error:\(counter):The list could not be sorted (\(why)).")
            }
        }
        return
    }
    #endif
    element.input("ai:error:\(counter):Apple Intelligence needs iOS 26 or macOS 26 or later.")
}

func aiStatus() -> String {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, macOS 26.0, *) {
        let model = SystemLanguageModel.default
        if model.isAvailable { return "ok" }
        let why = String(describing: model.availability).lowercased()
        if why.contains("noteligible") { return "ineligible" }
        if why.contains("notenabled") { return "notenabled" }
        return "notready"
    }
    #endif
    return "old"
}

#if canImport(FoundationModels)
private let departments = ["Produce", "Bakery", "Deli", "Meat & Seafood", "Dairy & Eggs", "Frozen", "Pantry", "Snacks", "Beverages", "Household", "Personal Care", "Other"]

/// The department list in walking order as "Department|id id;Department|id id": the model puts each item in one
/// department; any it drops, or puts in an unknown one, go to "Other".
@available(iOS 26.0, macOS 26.0, *)
@MainActor
private func sortByAisle(_ items: [(id: String, title: String)]) async throws -> String {
    let session = LanguageModelSession(instructions: """
        You sort grocery items into supermarket departments. The departments, in the order a shopper walks the store, are: \
        \(departments.joined(separator: ", ")). \
        Reply with one line per department you use, written as the department name, a colon, then the item numbers \
        separated by commas, for example "Produce: 1, 4". Put every item number in exactly one department.
        """)
    let prompt = items.enumerated().map { "\($0.offset + 1). \($0.element.title)" }.joined(separator: "\n")
    let text = try await session.respond(to: prompt).content
    var byDepartment: [String: [Int]] = [:], seen = Set<Int>()
    for line in text.split(separator: "\n") {
        let parts = line.split(separator: ":", maxSplits: 1).map { String($0).trimmingCharacters(in: .whitespaces) }
        guard parts.count == 2 else { continue }
        let name = departments.first { $0.lowercased() == parts[0].lowercased() || parts[0].lowercased().hasPrefix($0.lowercased().prefix(5)) } ?? "Other"
        for token in parts[1].split(whereSeparator: { !$0.isNumber }) {
            if let n = Int(token), n >= 1, n <= items.count, seen.insert(n - 1).inserted { byDepartment[name, default: []].append(n - 1) }
        }
    }
    if seen.isEmpty { throw CocoaError(.coderReadCorrupt) }
    for i in items.indices where !seen.contains(i) { byDepartment["Other", default: []].append(i) }
    return departments.compactMap { name in
        byDepartment[name].map { "\(name)|" + $0.map { items[$0].id }.joined(separator: " ") }
    }.joined(separator: ";")
}
#endif
#endif
