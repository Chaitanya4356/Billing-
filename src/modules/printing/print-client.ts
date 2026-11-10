// Browser-only: call from event handlers in client components, never during render.

declare global {
  interface Window {
    /** Test seam: when set, receipts are handed to it instead of the printer. */
    __PRINT_HOOK__?: (html: string) => void | Promise<void>;
  }
}

/** The iframe is removed this long after printing even if `afterprint` never fires. */
const CLEANUP_TIMEOUT_MS = 60_000;

/**
 * Prints a receipt document. Renders it into a hidden iframe (srcdoc), calls
 * print() once it has loaded and removes the iframe on `afterprint` or after
 * 60 s. If `window.__PRINT_HOOK__` is a function it is called with the HTML
 * instead and nothing is printed.
 */
export async function printReceiptHtml(html: string): Promise<void> {
  const hook = window.__PRINT_HOOK__;
  if (typeof hook === "function") {
    await hook(html);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    iframe.title = "Receipt";
    // Not display:none: a frame that is not rendered does not print reliably.
    Object.assign(iframe.style, {
      position: "fixed",
      right: "0",
      bottom: "0",
      width: "0",
      height: "0",
      border: "0",
      opacity: "0",
      pointerEvents: "none",
    });

    let removed = false;
    let loaded = false;
    const cleanup = () => {
      if (removed) return;
      removed = true;
      window.clearTimeout(timer);
      iframe.remove();
    };
    const timer = window.setTimeout(cleanup, CLEANUP_TIMEOUT_MS);

    iframe.addEventListener("load", () => {
      if (loaded) return;
      loaded = true;
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        reject(new Error("The receipt could not be prepared for printing"));
        return;
      }
      win.addEventListener("afterprint", cleanup);
      try {
        win.focus();
        win.print();
        resolve();
      } catch (e) {
        cleanup();
        reject(e instanceof Error ? e : new Error("Printing failed"));
      }
    });

    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}
