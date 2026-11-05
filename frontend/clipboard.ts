// Robust "copy to clipboard" with a legacy fallback.
//
// `navigator.clipboard` is undefined in insecure (non-HTTPS) contexts and older
// browsers, so `navigator.clipboard.writeText(...)` would throw. We guard it and
// fall back to a hidden <textarea> + document.execCommand("copy"), so Copy still
// works (or fails gracefully) instead of throwing. Returns true on success.
export async function copyText(text: string): Promise<boolean> {
  // Preferred path: the async Clipboard API (needs a secure context + permission).
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied / insecure context — fall through to the legacy path.
  }

  // Legacy fallback: select a hidden textarea and ask the document to copy it.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
