"use client";

import { useRef, useState } from "react";
import { formatPaise } from "@/lib/money";
import type { BillDetail } from "@/modules/bills/types";
import { printBillAction } from "@/modules/printing/actions";
import { printReceiptHtml } from "@/modules/printing/print-client";

/**
 * Full-screen confirmation after a successful charge. Nothing prints by
 * itself: every Print click records one print on the server (the first is the
 * original, later ones come back marked REPRINT) and sends it to the printer.
 */
export function SuccessScreen({
  bill,
  warning,
  onNewBill,
}: {
  bill: BillDetail;
  /** Shown when the saved bill differs from what the screen displayed (an earlier attempt was replayed). */
  warning: string | null;
  onNewBill: () => void;
}) {
  const printingRef = useRef(false);
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  async function print() {
    if (printingRef.current) return;
    printingRef.current = true;
    setPrinting(true);
    setPrintStatus(null);
    try {
      const result = await printBillAction(bill.id);
      if (!result.ok) {
        setPrintStatus({ kind: "error", message: `Could not print: ${result.error.message}` });
        return;
      }
      await printReceiptHtml(result.data.html);
      setPrintStatus({
        kind: "ok",
        message: result.data.isReprint ? "Reprint sent to the printer." : "Receipt sent to the printer.",
      });
    } catch {
      setPrintStatus({ kind: "error", message: "Printing failed. The bill is saved; press Print to try again." });
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  }

  const change = bill.payment.method === "CASH" ? bill.payment.changePaise : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="success-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-white p-4"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <h2 id="success-title" className="text-xl font-semibold text-green-800">
          Bill saved
        </h2>
        <div>
          <p className="text-sm font-medium tracking-widest text-gray-600 uppercase">Token</p>
          <p data-testid="success-token" className="text-9xl leading-none font-black tabular-nums">
            {bill.tokenNumber}
          </p>
        </div>
        <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-1 text-left text-base">
          <dt className="text-gray-600">Bill number</dt>
          <dd data-testid="success-bill-number" className="text-right font-medium tabular-nums">
            {bill.billNumberDisplay}
          </dd>
          <dt className="text-gray-600">Total</dt>
          <dd data-testid="success-total" className="text-right text-xl font-bold tabular-nums">
            {formatPaise(bill.totalPaise)}
          </dd>
          <dt className="text-gray-600">Paid by</dt>
          <dd className="text-right">{bill.payment.method === "CASH" ? "Cash" : "UPI"}</dd>
          {change !== null && (
            <>
              <dt className="text-gray-600">Change due</dt>
              <dd className="text-right font-semibold tabular-nums">{formatPaise(change)}</dd>
            </>
          )}
        </dl>
        {warning && (
          <p role="alert" className="w-full rounded border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-900">
            {warning}
          </p>
        )}
        <div className="flex w-full gap-3">
          <button
            type="button"
            // The primary action for the next step; focused when the screen opens.
            autoFocus
            disabled={printing}
            onClick={print}
            className="min-h-14 flex-1 rounded-xl bg-gray-900 px-4 text-lg font-bold text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {printing ? "Printing…" : "Print"}
          </button>
          <button
            type="button"
            onClick={onNewBill}
            className="min-h-14 flex-1 rounded-xl border-2 border-gray-900 px-4 text-lg font-bold text-gray-900 hover:bg-gray-100"
          >
            New Bill
          </button>
        </div>
        <div role="status" aria-live="polite" className="min-h-6 text-sm">
          {printStatus && (
            <span className={printStatus.kind === "error" ? "text-red-700" : "text-gray-700"}>{printStatus.message}</span>
          )}
        </div>
      </div>
    </div>
  );
}
