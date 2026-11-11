/**
 * Small DOM toolkit: element factory, icons, toast, and accessible bottom
 * sheets with focus trapping and drag-to-dismiss.
 */
const SVG_NS = "http://www.w3.org/2000/svg";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h("button", { class: "x", onclick }, "Label") */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith("--")) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    } else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

export function icon(name, cls = "i") {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("class", cls);
  s.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#i-${name}`);
  s.append(use);
  return s;
}

export function pathIcon(d, cls = "i") {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("class", cls);
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", d);
  s.append(p);
  return s;
}

export const haptic = (pattern = 8) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
};

export function shake(el) {
  el.classList.remove("shake");
  void el.offsetWidth; // restart animation
  el.classList.add("shake");
}

export function createToast(root) {
  const msg = $("[data-toast-msg]", root);
  const action = $("[data-toast-action]", root);
  let timer;
  const hide = () => root.classList.remove("is-visible");
  return function show(text, { actionLabel = "Undo", onAction, duration } = {}) {
    msg.textContent = text;
    action.hidden = !onAction;
    action.textContent = actionLabel;
    action.onclick = onAction ? () => { onAction(); hide(); } : null;
    root.classList.add("is-visible");
    clearTimeout(timer);
    timer = setTimeout(hide, duration ?? (onAction ? 5000 : 2400));
  };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

export function createSheetController(scrim) {
  let active = null;
  let returnFocus = null;

  function open(sheet, { initialFocus } = {}) {
    if (active) close({ restoreFocus: false }); // switching sheets keeps the original return target
    else returnFocus = document.activeElement;
    active = sheet;
    sheet.style.transform = "";
    scrim.hidden = false;
    sheet.hidden = false;
    void sheet.offsetHeight; // commit initial position so the transition runs
    scrim.classList.add("is-open");
    sheet.classList.add("is-open");
    document.documentElement.classList.add("has-sheet");
    sheet.scrollTop = 0;
    setTimeout(() => (initialFocus ?? sheet).focus({ preventScroll: true }), 60);
  }

  function close({ restoreFocus = true } = {}) {
    if (!active) return;
    const sheet = active;
    active = null;
    sheet.classList.remove("is-open");
    scrim.classList.remove("is-open");
    document.documentElement.classList.remove("has-sheet");
    setTimeout(() => {
      sheet.style.transform = "";
      if (active !== sheet) sheet.hidden = true;
      if (!active) scrim.hidden = true;
    }, 380);
    if (restoreFocus) {
      returnFocus?.focus?.({ preventScroll: true });
      returnFocus = null;
    }
  }

  scrim.addEventListener("click", () => close());
  document.addEventListener("keydown", (e) => {
    if (!active) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      const nodes = $$(FOCUSABLE, active).filter((n) => !n.closest("[hidden]") && n.getClientRects().length);
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === active)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  return { open, close, get active() { return active; } };
}

/** Swipe a sheet down by its handle to dismiss it, like a native sheet. */
export function enableDragToDismiss(sheet, dismiss) {
  const handle = $("[data-drag-handle]", sheet);
  if (!handle) return;
  let startY = 0, dy = 0, t0 = 0, dragging = false;

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button, input, select, a")) return;
    dragging = true;
    startY = e.clientY;
    dy = 0;
    t0 = performance.now();
    sheet.style.transition = "none";
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = "";
    const velocity = dy / Math.max(1, performance.now() - t0);
    if (dy > 110 || (dy > 30 && velocity > 0.6)) {
      sheet.style.transform = "translateY(100%)";
      dismiss();
    } else {
      sheet.style.transform = "";
    }
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}
