/**
 * Component: iOS keyboard viewport shim (injected into the exact web client's index.html)
 * Documentation: documentation/frontend/pages/notes/rich-text.md
 *
 * iOS Safari ignores `interactive-widget=resizes-content`: with the on-screen
 * keyboard up it keeps the layout viewport full height and pans the visual
 * viewport to the focused field, sliding the app's header off the top. Instead:
 * - size html/body to the visual viewport, and translate body by the pan so the
 *   app stays pinned to what is visible (following the pan, never fighting it:
 *   resetting scroll on each event made the page bounce);
 * - hide the tab bar while the keyboard is up (as iOS apps do);
 * - scroll the focused field's own scroller so its caret clears the keyboard.
 */
(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const style = document.createElement("style");
  // The body translate adds scrollable overflow below the layout viewport, so a
  // swipe could scroll the document instead of the form under the finger
  // (the modal's form "sometimes" fought): lock document scroll while typing.
  style.textContent = 'html[data-keyboard] [data-testid="tabs"]{display:none!important}' +
    'html[data-keyboard],html[data-keyboard] body{overflow:hidden!important;overscroll-behavior:none}' +
    // Note editor on the web: the textarea grows with its content inside the page scroller (the
    // contract's native layout is a viewport-high textarea that scrolls itself).
    '[data-testid="note-edit-column"]{height:auto!important;min-height:100%;display:flex;flex-direction:column}' +
    '[data-testid="note-body"]{flex:1 0 auto!important;height:auto!important;min-height:0!important;field-sizing:content!important;overflow-y:hidden!important}';
  document.head.append(style);

  const scrollerOf = (el) => {
    for (let n = el?.parentElement; n; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
    }
    return null;
  };

  // The caret's rect: the selection's for a contenteditable editor, a mirror's
  // for a textarea/input (which expose no caret geometry).
  const caretRect = (el) => {
    if (!el) return null;
    if (el.localName !== "textarea") {
      if (el.localName === "input") return el.getBoundingClientRect();
      const sel = window.getSelection();
      if (!sel?.rangeCount) return null;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      return r.height ? r : el.getBoundingClientRect();
    }
    const cs = getComputedStyle(el);
    const m = document.createElement("div");
    for (const p of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderLeftWidth", "boxSizing", "tabSize"]) m.style[p] = cs[p];
    Object.assign(m.style, { position: "absolute", visibility: "hidden", top: "0", left: "0", width: `${el.offsetWidth}px`, whiteSpace: "pre-wrap", overflowWrap: "break-word" });
    m.textContent = el.value.slice(0, el.selectionStart ?? 0);
    const mark = document.createElement("span");
    mark.textContent = "​";
    m.append(mark);
    document.body.append(m);
    const top = el.getBoundingClientRect().top + mark.offsetTop - el.scrollTop;
    const height = mark.offsetHeight || parseFloat(cs.lineHeight) || 20;
    m.remove();
    return { top, bottom: top + height };
  };

  let keyboard = false;
  let lastPan = 0;
  // Correct only after Safari has finished its own focus scrolling (it scrolls
  // every scrollable ancestor plus the visual viewport); correcting during it
  // made nested scrollers fight.
  let revealTimer = 0;
  const reveal = () => {
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => {
      if (!keyboard) return;
      const field = document.activeElement;
      const scroller = scrollerOf(field);
      const caret = caretRect(field);
      if (!scroller || !caret) return;
      // Rects are layout-viewport coordinates; what is visible is
      // [offsetTop, offsetTop + height] there (body is translated by the pan).
      const box = scroller.getBoundingClientRect();
      const top = Math.max(box.top, vv.offsetTop) + 8;
      const bottom = Math.min(box.bottom, vv.offsetTop + vv.height) - 56; // clear the floating info footer
      if (caret.bottom > bottom) scroller.scrollBy({ top: caret.bottom - bottom, behavior: "smooth" });
      else if (caret.top < top) scroller.scrollBy({ top: caret.top - top, behavior: "smooth" });
    }, 350);
  };

  let lastH = "";
  const fit = () => {
    // innerHeight shrinks with the keyboard on iOS; the layout viewport does not.
    const kb = root.clientHeight - vv.height > 1;
    const opened = kb && !keyboard;
    keyboard = kb;
    root.toggleAttribute("data-keyboard", kb);
    const h = kb ? `${Math.round(vv.height)}px` : "";
    if (h !== lastH) {
      lastH = h;
      root.style.height = h;
      document.body.style.height = h;
    }
    // Follow Safari's pan instead of undoing it. Keep a transform (even 0) the
    // whole time the keyboard is up: a transformed body is the containing block
    // of exact's `position: fixed` modals, so they always fit the visible area.
    // Toggling it only when the pan was non-zero resized the modal mid-focus,
    // which made Safari re-pan: a feedback loop that read as vibration.
    const pan = kb ? Math.max(0, Math.round(vv.pageTop)) : 0;
    document.body.style.transform = kb ? `translateY(${pan}px)` : "";
    // exact places anchored popovers from measured rects: re-measure after the pan moves things.
    if (pan !== lastPan) {
      lastPan = pan;
      window.dispatchEvent(new Event("resize"));
    }
    if (opened) reveal();
  };
  // At most one layout write per frame, whatever Safari's event rate.
  let fitQueued = false;
  const queueFit = () => {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(() => {
      fitQueued = false;
      fit();
    });
  };
  // A finger on the screen owns scrolling: drop a pending caret correction.
  document.addEventListener("touchstart", () => clearTimeout(revealTimer), { passive: true });
  vv.addEventListener("resize", queueFit);
  vv.addEventListener("scroll", queueFit);
  document.addEventListener("focusin", () => keyboard && reveal());
})();
