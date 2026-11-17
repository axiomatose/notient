// The `formatbar` hatch on iOS: an Apple-Notes-style glass bubble toolbar as the note body's inputAccessoryView.
// Documentation: documentation/frontend/pages/notes/rich-text.md ("Native format bar (iOS)").
// Two nodes carry the word (data-role): "editor" (the note-body textarea: gets the bar, data-formats and
// data-unavailable say what is active/off) and "bridge" (a hidden input: the bar acts on the contract only
// through bridge.input("cmd:<name>:<n>"); "platform:ios" tells the contract to hide its in-page toolbar).
#if os(iOS)
import UIKit

private final class FormatBarState {
    var bridge: ExactElement?
    var editor: ExactElement?
    var bar: FormatBarView?
    var counter = 0
    var link: LinkEntry?
    var styler: LinkStyler?
}
nonisolated(unsafe) private let state = FormatBarState()

/// Built (`element.isNew`) and changed (a `data-*` word moved).
func formatbarHatch(_ element: ExactElement) {
    switch element.data[.role] {
    case "bridge":
        state.bridge = element
        // The bridge value is the contract's, so tell it once per mount.
        if element.isNew { element.input("platform:ios"); element.diagnostics.log("bridge ready") }
    case "editor":
        state.editor = element
        guard let textView = element.textView else { return element.diagnostics.log("editor has no UITextView") }
        let bar = state.bar ?? FormatBarView()
        if state.bar == nil {
            state.bar = bar
            bar.onCommand = { name in
                if name == "link" { return beginLink(textView, existing: element.data[.link] ?? "") }
                guard let bridge = state.bridge, bridge.isLive else { return }
                state.counter += 1
                bridge.input("cmd:\(name):\(state.counter)")
            }
        }
        if state.styler?.textView !== textView { state.styler = LinkStyler(textView) }
        bar.apply(formats: element.data[.formats] ?? "", unavailable: element.data[.unavailable] ?? "", images: element.data[.images] != "0")
        if textView.inputAccessoryView !== bar {
            textView.inputAccessoryView = bar
            if textView.isFirstResponder { textView.reloadInputViews() }
            element.diagnostics.log("accessory installed")
        }
    default: break
    }
}

/// The node is leaving, its view still there: take back what the hatch added.
func formatbarHatchEnded(_ element: ExactElement) {
    switch element.data[.role] {
    case "bridge": if state.bridge === element { state.bridge = nil }
    case "editor":
        if state.editor === element {
            if let textView = element.textView, textView.inputAccessoryView === state.bar {
                textView.inputAccessoryView = nil
                if textView.isFirstResponder { textView.reloadInputViews() }
            }
            state.link?.cancel()
            state.styler = nil
            state.editor = nil; state.bar = nil
        }
    default: break
    }
}

/// The link tool: a hidden proxy field takes the keyboard (URL keyboard, no auto-capital, `.com` key) with
/// `LinkBarView` as its accessory; Apply hands the address to the contract (`link:<n>:<url>`) and the note's
/// text view takes the keyboard back, selection intact.
private func beginLink(_ textView: UITextView, existing: String) {
    state.link?.cancel()
    let entry = LinkEntry(textView: textView, existing: existing)
    state.link = entry
    entry.begin()
}

final class LinkEntry: NSObject, UITextFieldDelegate {
    private weak var textView: UITextView?
    private let field = UITextField()
    private let bar = LinkBarView()
    private let existing: String
    private var done = false

    init(textView: UITextView, existing: String) {
        self.textView = textView
        self.existing = existing
        super.init()
        field.keyboardType = .URL
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.spellCheckingType = .no
        field.textContentType = .URL
        field.returnKeyType = .go
        field.enablesReturnKeyAutomatically = false
        field.delegate = self
        field.text = existing
        field.alpha = 0.011
        field.frame = CGRect(x: 0, y: 0, width: 1, height: 1)
        field.inputAccessoryView = bar
        bar.onApply = { [weak self] in self?.apply() }
        bar.onCancel = { [weak self] in self?.cancel() }
        bar.configure(removing: !existing.isEmpty)
        field.addAction(UIAction { [weak self] _ in self?.mirror() }, for: .editingChanged)
    }

    func begin() {
        guard let textView, let host = textView.superview else { return }
        host.addSubview(field)
        mirror()
        field.becomeFirstResponder()
    }

    private func mirror() { bar.show(text: field.text ?? "", removing: !existing.isEmpty) }

    private func finish() -> Bool {
        guard !done else { return false }
        done = true
        field.resignFirstResponder()
        field.removeFromSuperview()
        textView?.becomeFirstResponder()
        if state.link === self { state.link = nil }
        return true
    }

    func cancel() { _ = finish() }

    func apply() {
        var url = (field.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !url.isEmpty && !url.contains("://") && !url.hasPrefix("mailto:") && !url.hasPrefix("tel:") && !url.hasPrefix("/") && !url.hasPrefix("#") { url = "https://" + url }
        guard finish() else { return }
        if url.isEmpty && existing.isEmpty { return }
        guard let bridge = state.bridge, bridge.isLive else { return }
        state.counter += 1
        bridge.input("link:\(state.counter):\(url)")
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool { apply(); return false }
}

/// Link entry bar: the typed address (the proxy field is hidden) between two glass bubbles, cancel and apply.
final class LinkBarView: UIView {
    var onApply: (() -> Void)?
    var onCancel: (() -> Void)?
    private let main = glassBubble()
    private let cancelBubble = glassBubble()
    private let applyBubble = glassBubble()
    private let label = UILabel()
    private let icon = UIImageView(image: UIImage(systemName: "link"))
    private let apply = UIButton(type: .system)

    override init(frame: CGRect) {
        super.init(frame: CGRect(x: 0, y: 0, width: 320, height: 56))
        autoresizingMask = [.flexibleWidth]
        backgroundColor = .clear
        for v in [main, cancelBubble, applyBubble] { addSubview(v) }
        icon.tintColor = .secondaryLabel
        icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 15, weight: .medium)
        label.font = .preferredFont(forTextStyle: .body)
        label.lineBreakMode = .byTruncatingHead
        icon.translatesAutoresizingMaskIntoConstraints = false
        label.translatesAutoresizingMaskIntoConstraints = false
        main.contentView.addSubview(icon); main.contentView.addSubview(label)
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: main.contentView.leadingAnchor, constant: 14),
            icon.centerYAnchor.constraint(equalTo: main.contentView.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 8),
            label.trailingAnchor.constraint(equalTo: main.contentView.trailingAnchor, constant: -14),
            label.centerYAnchor.constraint(equalTo: main.contentView.centerYAnchor),
        ])
        let cancel = UIButton(type: .system)
        cancel.setImage(UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .semibold)), for: .normal)
        cancel.tintColor = .label
        cancel.accessibilityLabel = "Cancel link"
        cancel.accessibilityIdentifier = "fmtbar-link-cancel"
        cancel.addAction(UIAction { [weak self] _ in self?.onCancel?() }, for: .touchUpInside)
        apply.setImage(UIImage(systemName: "checkmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .semibold)), for: .normal)
        apply.tintColor = .systemBlue
        apply.accessibilityLabel = "Apply link"
        apply.accessibilityIdentifier = "fmtbar-link-apply"
        apply.addAction(UIAction { [weak self] _ in self?.onApply?() }, for: .touchUpInside)
        for (button, bubble) in [(cancel, cancelBubble), (apply, applyBubble)] {
            button.translatesAutoresizingMaskIntoConstraints = false
            bubble.contentView.addSubview(button)
            NSLayoutConstraint.activate([
                button.leadingAnchor.constraint(equalTo: bubble.contentView.leadingAnchor),
                button.trailingAnchor.constraint(equalTo: bubble.contentView.trailingAnchor),
                button.topAnchor.constraint(equalTo: bubble.contentView.topAnchor),
                button.bottomAnchor.constraint(equalTo: bubble.contentView.bottomAnchor),
            ])
        }
    }
    required init?(coder: NSCoder) { fatalError() }

    func configure(removing: Bool) { show(text: "", removing: removing) }

    func show(text: String, removing: Bool) {
        if text.isEmpty {
            label.text = removing ? "Empty removes the link" : "Website address"
            label.textColor = .placeholderText
        } else {
            label.text = text
            label.textColor = .label
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let h: CGFloat = 44, y = (bounds.height - h) / 2, inset: CGFloat = 10
        applyBubble.frame = CGRect(x: bounds.width - inset - h, y: y, width: h, height: h)
        cancelBubble.frame = CGRect(x: applyBubble.frame.minX - 8 - h, y: y, width: h, height: h)
        main.frame = CGRect(x: inset, y: y, width: cancelBubble.frame.minX - 8 - inset, height: h)
        for bubble in [main, cancelBubble, applyBubble] { bubble.layer.cornerRadius = h / 2 }
    }
}

/// exact's Markdown editor draws a link as underlined text in the body colour; Apple draws links bold and
/// blue. Re-applied after each of exact's restyles (the text storage's own processing notification).
final class LinkStyler {
    private(set) weak var textView: UITextView?
    private var token: NSObjectProtocol?
    private var queued = false

    init(_ textView: UITextView) {
        self.textView = textView
        token = NotificationCenter.default.addObserver(forName: NSTextStorage.didProcessEditingNotification, object: textView.textStorage, queue: .main) { [weak self] _ in
            self?.schedule()
        }
        schedule()
    }
    deinit { if let token { NotificationCenter.default.removeObserver(token) } }

    private func schedule() {
        guard !queued else { return }
        queued = true
        DispatchQueue.main.async { [weak self] in
            self?.queued = false
            self?.style()
        }
    }

    private func style() {
        guard let storage = textView?.textStorage, storage.length > 0 else { return }
        var runs: [NSRange] = []
        storage.enumerateAttribute(.link, in: NSRange(location: 0, length: storage.length)) { value, range, _ in
            guard value != nil else { return }
            let color = storage.attribute(.foregroundColor, at: range.location, effectiveRange: nil) as? UIColor
            let font = storage.attribute(.font, at: range.location, effectiveRange: nil) as? UIFont
            let underlined = (storage.attribute(.underlineStyle, at: range.location, effectiveRange: nil) as? Int ?? 0) != 0
            if underlined || color != .systemBlue || !(font?.fontDescriptor.symbolicTraits.contains(.traitBold) ?? true) { runs.append(range) }
        }
        guard !runs.isEmpty else { return }
        storage.beginEditing()
        for range in runs {
            storage.addAttribute(.foregroundColor, value: UIColor.systemBlue, range: range)
            storage.addAttribute(.underlineStyle, value: 0, range: range)
            storage.enumerateAttribute(.font, in: range) { value, sub, _ in
                guard let font = value as? UIFont, let bold = font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(.traitBold)) else { return }
                storage.addAttribute(.font, value: UIFont(descriptor: bold, size: font.pointSize), range: sub)
            }
        }
        storage.endEditing()
    }
}

private func glassBubble() -> UIVisualEffectView {
    let effect: UIVisualEffect
    if #available(iOS 26, *) {
        let glass = UIGlassEffect()
        glass.isInteractive = true
        effect = glass
    } else {
        effect = UIBlurEffect(style: .systemThinMaterial)
    }
    let view = UIVisualEffectView(effect: effect)
    view.layer.cornerCurve = .continuous
    view.clipsToBounds = true
    return view
}

final class FormatBarView: UIView {
    var onCommand: ((String) -> Void)?
    private struct Item { let name: String; let symbol: String }
    private let groups: [[Item]] = [
        [Item(name: "bold", symbol: "bold"), Item(name: "italic", symbol: "italic"),
         Item(name: "strike", symbol: "strikethrough"), Item(name: "code", symbol: "chevron.left.forwardslash.chevron.right")],
        [Item(name: "heading", symbol: "textformat.size")],
        [Item(name: "bullet", symbol: "list.bullet"), Item(name: "ordered", symbol: "list.number"), Item(name: "task", symbol: "checklist")],
        [Item(name: "quote", symbol: "text.quote"), Item(name: "codeblock", symbol: "curlybraces")],
        [Item(name: "link", symbol: "link"), Item(name: "image", symbol: "photo")],
        [Item(name: "outdent", symbol: "decrease.indent"), Item(name: "indent", symbol: "increase.indent")],
    ]
    private var buttons: [String: UIButton] = [:]
    private var dividers: [UIView] = []
    private var groupButtons: [[UIButton]] = []
    private var stack = UIStackView()
    private let main = glassBubble()
    private let dismissBubble = glassBubble()
    private let haptic = UIImpactFeedbackGenerator(style: .light)

    override init(frame: CGRect) {
        super.init(frame: CGRect(x: 0, y: 0, width: 320, height: 56))
        autoresizingMask = [.flexibleWidth]
        backgroundColor = .clear
        addSubview(main); addSubview(dismissBubble)
        let scroll = UIScrollView()
        scroll.showsHorizontalScrollIndicator = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        main.contentView.addSubview(scroll)
        stack = UIStackView()
        stack.axis = .horizontal; stack.alignment = .center; stack.spacing = 2
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: main.contentView.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: main.contentView.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: main.contentView.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: main.contentView.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -8),
            stack.centerYAnchor.constraint(equalTo: scroll.frameLayoutGuide.centerYAnchor),
        ])
        for (index, group) in groups.enumerated() {
            if index > 0 {
                let divider = UIView()
                divider.backgroundColor = .separator
                divider.translatesAutoresizingMaskIntoConstraints = false
                divider.widthAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale).isActive = true
                divider.heightAnchor.constraint(equalToConstant: 20).isActive = true
                dividers.append(divider)
                stack.addArrangedSubview(divider)
                stack.setCustomSpacing(6, after: stack.arrangedSubviews[stack.arrangedSubviews.count - 2])
                stack.setCustomSpacing(6, after: divider)
            }
            var made: [UIButton] = []
            for item in group {
                let button = makeButton(item.name, item.symbol, label: item.name)
                made.append(button)
                stack.addArrangedSubview(button)
            }
            groupButtons.append(made)
        }
        let dismiss = makeButton("dismiss", "keyboard.chevron.compact.down", label: "Dismiss keyboard")
        dismiss.translatesAutoresizingMaskIntoConstraints = false
        dismissBubble.contentView.addSubview(dismiss)
        NSLayoutConstraint.activate([
            dismiss.centerXAnchor.constraint(equalTo: dismissBubble.contentView.centerXAnchor),
            dismiss.centerYAnchor.constraint(equalTo: dismissBubble.contentView.centerYAnchor),
        ])
        buttons["dismiss"] = dismiss
    }
    required init?(coder: NSCoder) { fatalError() }

    private func makeButton(_ name: String, _ symbol: String, label: String) -> UIButton {
        var config = UIButton.Configuration.plain()
        config.image = UIImage(systemName: symbol)
        config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 16, weight: .medium)
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8)
        config.cornerStyle = .capsule
        let button = UIButton(configuration: config)
        button.accessibilityLabel = label
        button.accessibilityIdentifier = "fmtbar-\(name)"
        button.tintColor = .label
        // A UIControl in an inputAccessoryView never takes first responder from the text view.
        button.addAction(UIAction { [weak self] _ in
            self?.haptic.impactOccurred()
            self?.onCommand?(name)
        }, for: .touchUpInside)
        button.widthAnchor.constraint(equalToConstant: 40).isActive = true
        button.heightAnchor.constraint(equalToConstant: 40).isActive = true
        buttons[name] = button
        return button
    }

    /// Tools that cannot apply here leave the bar on a phone (it stays as small as it can) and are muted on
    /// wider screens. Indent and outdent only mean something on a list line.
    func apply(formats: String, unavailable: String, images: Bool = true) {
        let on = Set(formats.split(separator: " ").map(String.init))
        var off = Set(unavailable.split(separator: " ").map(String.init))
        if !(on.contains("bullet") || on.contains("ordered") || on.contains("task")) { off.formUnion(["indent", "outdent"]) }
        let hide = UIDevice.current.userInterfaceIdiom == .phone
        var changed = false
        for (name, button) in buttons where name != "dismiss" {
            let active = name == "heading" ? on.contains { $0.hasPrefix("heading") } : on.contains(name)
            let disabled = off.contains(name) && name != "image"
            var config = button.configuration ?? .plain()
            config.baseForegroundColor = active ? .systemBlue : .label
            config.background.backgroundColor = active ? UIColor.systemBlue.withAlphaComponent(0.16) : .clear
            button.configuration = config
            button.isEnabled = !disabled
            button.alpha = disabled ? 0.35 : 1
            button.accessibilityLabel = active ? "\(name) active" : name
            let gone = (disabled && hide) || (name == "image" && !images)
            if button.isHidden != gone { button.isHidden = gone; changed = true }
        }
        for (index, divider) in dividers.enumerated() {
            // A divider sits before group index+1: shown only between two groups that still have a tool.
            let before = groupButtons[...index].contains { $0.contains { !$0.isHidden } }
            let after = groupButtons[(index + 1)...].contains { $0.contains { !$0.isHidden } }
            let gone = !(before && after)
            if divider.isHidden != gone { divider.isHidden = gone; changed = true }
        }
        if changed && window != nil { UIView.animate(withDuration: 0.16) { self.stack.layoutIfNeeded() } }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let h: CGFloat = 44, y = (bounds.height - h) / 2, inset: CGFloat = 10
        dismissBubble.frame = CGRect(x: bounds.width - inset - h, y: y, width: h, height: h)
        main.frame = CGRect(x: inset, y: y, width: dismissBubble.frame.minX - 8 - inset, height: h)
        for bubble in [main, dismissBubble] { bubble.layer.cornerRadius = h / 2 }
    }
}
#endif
