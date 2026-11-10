"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { formatPaise } from "@/lib/money";
import { formatDateTimeIST } from "@/lib/time";
import type { Role } from "@/lib/types";
import { cancelBillAction, getBillAction } from "@/modules/bills/actions";
import { cancelReasonSchema } from "@/modules/bills/schema";
import type { BillDetail } from "@/modules/bills/types";
import { printBillAction } from "@/modules/printing/actions";
import { printReceiptHtml } from "@/modules/printing/print-client";
import { StatusBadge } from "./StatusBadge";

type Loaded = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; bill: BillDetail };

/** CGST/SGST rate in percent, e.g. 250 basis points per half -> "2.5". */
function halfRatePercent(rateBp: number): string {
  return String(rateBp / 200);
}

const BUTTON = "min-h-11 rounded-lg px-4 font-medium disabled:opacity-60";

/**
 * Side panel with one bill: items, totals, payment, customer and cancel
 * details, with Reprint and (when allowed) Cancel. Opening it never prints.
 */
export function BillDrawer({
  billId,
  billNumberDisplay,
  role,
  cashierCanCancel,
  onClose,
  onCancelled,
}: {
  billId: string;
  billNumberDisplay: string;
  role: Role;
  cashierCanCancel: boolean;
  onClose: () => void;
  /** Called after the server cancelled the bill. */
  onCancelled: (billId: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [printing, setPrinting] = useState(false);
  const printingRef = useRef(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printNote, setPrintNote] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    let active = true;
    getBillAction(billId)
      .then((r) => {
        if (!active) return;
        setLoaded(r.ok ? { kind: "ready", bill: r.data } : { kind: "error", message: r.error.message });
      })
      .catch(() => {
        if (active) setLoaded({ kind: "error", message: "Could not load this bill. Try again." });
      });
    return () => {
      active = false;
    };
  }, [billId]);

  async function reprint() {
    if (printingRef.current) return;
    printingRef.current = true;
    setPrinting(true);
    setPrintError(null);
    setPrintNote(null);
    try {
      const result = await printBillAction(billId);
      if (!result.ok) {
        setPrintError(`Could not print: ${result.error.message}`);
        return;
      }
      await printReceiptHtml(result.data.html);
      setPrintNote(result.data.isReprint ? "Reprint sent to the printer." : "Receipt sent to the printer.");
      // The server counted this print: show the new count.
      const fresh = await getBillAction(billId);
      if (fresh.ok) setLoaded({ kind: "ready", bill: fresh.data });
    } catch {
      setPrintError("Printing failed. Press Reprint to try again.");
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") onClose();
  }

  const bill = loaded.kind === "ready" ? loaded.bill : null;
  const canCancel = bill !== null && bill.status !== "CANCELLED" && (role === "OWNER" || cashierCanCancel);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bill-drawer-title"
        onKeyDown={onKeyDown}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <h2 id="bill-drawer-title" className="text-lg font-semibold">
            Bill {billNumberDisplay}
          </h2>
          <div className="flex items-center gap-2">
            {bill && <StatusBadge status={bill.status} testId="bill-status" />}
            <button
              type="button"
              autoFocus
              onClick={onClose}
              className="min-h-11 rounded-lg border border-gray-300 px-4 font-medium hover:bg-gray-100"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm">
          {loaded.kind === "loading" && (
            <p role="status" className="text-gray-600">
              Loading…
            </p>
          )}
          {loaded.kind === "error" && (
            <p role="alert" className="text-red-700">
              {loaded.message}
            </p>
          )}
          {bill && <BillBody bill={bill} />}
        </div>

        {bill && (
          <div className="space-y-2 border-t border-gray-200 p-4">
            {printError && (
              <p role="alert" className="text-sm text-red-700">
                {printError}
              </p>
            )}
            <div role="status" aria-live="polite" className="text-sm text-gray-700">
              {printNote}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={printing}
                onClick={reprint}
                className={`${BUTTON} flex-1 bg-gray-900 text-white hover:bg-gray-800`}
              >
                {printing ? "Printing…" : "Reprint"}
              </button>
              {canCancel && (
                <button
                  type="button"
                  onClick={() => setCancelOpen(true)}
                  className={`${BUTTON} flex-1 border border-red-700 text-red-700 hover:bg-red-50`}
                >
                  Cancel bill
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {cancelOpen && bill && (
        <CancelDialog
          billId={bill.id}
          onClose={() => setCancelOpen(false)}
          onCancelled={(updated) => {
            setCancelOpen(false);
            setLoaded({ kind: "ready", bill: updated });
            onCancelled(updated.id);
          }}
        />
      )}
    </>
  );
}

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <>
      <dt className="text-gray-600">{label}</dt>
      <dd data-testid={testId} className="text-right tabular-nums">
        {children}
      </dd>
    </>
  );
}

function BillBody({ bill }: { bill: BillDetail }) {
  const { payment } = bill;
  const cancelled = bill.status === "CANCELLED";
  const halfRate = halfRatePercent(bill.gstSnapshot.rateBp);
  const taxSuffix = bill.taxIncluded ? " (included)" : "";

  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <Row label="Token">{bill.tokenNumber}</Row>
        <Row label="Date and time">{formatDateTimeIST(new Date(bill.createdAt))}</Row>
        <Row label="Business date">{bill.businessDate}</Row>
        {bill.customerName && <Row label="Customer">{bill.customerName}</Row>}
        {bill.customerPhone && <Row label="Phone">{bill.customerPhone}</Row>}
      </dl>

      <table className="w-full text-left">
        <caption className="sr-only">Items</caption>
        <thead className="border-b border-gray-200 text-gray-600">
          <tr>
            <th scope="col" className="py-1 pr-2 font-medium">
              Item
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">
              Qty
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">
              Price
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {bill.items.map((item, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="py-1 pr-2">{item.productName}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{item.quantity}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatPaise(item.unitPricePaise)}</td>
              <td className="py-1 text-right tabular-nums">{formatPaise(item.lineTotalPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <Row label="Subtotal">{formatPaise(bill.subtotalPaise)}</Row>
        {bill.discountPaise > 0 && <Row label="Discount">-{formatPaise(bill.discountPaise)}</Row>}
        {bill.taxPaise > 0 && (
          <>
            <Row label={`CGST ${halfRate}%${taxSuffix}`}>{formatPaise(bill.cgstPaise)}</Row>
            <Row label={`SGST ${halfRate}%${taxSuffix}`}>{formatPaise(bill.sgstPaise)}</Row>
          </>
        )}
        {bill.roundOffPaise !== 0 && (
          <Row label="Round off">
            {bill.roundOffPaise < 0 ? "-" : "+"}
            {formatPaise(Math.abs(bill.roundOffPaise))}
          </Row>
        )}
        <dt className="text-base font-semibold">Total</dt>
        <dd data-testid="bill-total" className="text-right text-base font-bold tabular-nums">
          {formatPaise(bill.totalPaise)}
        </dd>
      </dl>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-gray-200 pt-3">
        <Row label="Payment" testId="bill-payment-method">
          {payment.method === "CASH" ? "Cash" : "UPI"}
        </Row>
        {payment.status === "VOIDED" && (
          <Row label="Payment status">
            <span className="font-semibold text-red-800">VOIDED</span>
          </Row>
        )}
        {payment.method === "CASH" && payment.cashTenderedPaise !== null && (
          <Row label="Cash tendered" testId="bill-tendered">
            {formatPaise(payment.cashTenderedPaise)}
          </Row>
        )}
        {payment.method === "CASH" && payment.changePaise !== null && (
          <Row label="Change given" testId="bill-change">
            {formatPaise(payment.changePaise)}
          </Row>
        )}
        {payment.method === "UPI" && payment.upiReference && <Row label="UPI reference">{payment.upiReference}</Row>}
        <Row label="Print count" testId="bill-print-count">
          {bill.printCount}
        </Row>
      </dl>

      {cancelled && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-red-200 bg-red-50 p-3">
          <Row label="Cancelled at" testId="bill-cancelled-at">
            {bill.cancelledAt ? formatDateTimeIST(new Date(bill.cancelledAt)) : "-"}
          </Row>
          <dt className="text-gray-600">Reason</dt>
          <dd data-testid="bill-cancel-reason" className="text-right break-words">
            {bill.cancelReason}
          </dd>
        </dl>
      )}
    </>
  );
}

/** Asks for the reason (3 to 200 characters), checks it locally, then cancels. */
function CancelDialog({
  billId,
  onClose,
  onCancelled,
}: {
  billId: string;
  onClose: () => void;
  onCancelled: (bill: BillDetail) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pendingRef.current) return;
    const checked = cancelReasonSchema.safeParse(reason);
    if (!checked.success) {
      setError(checked.error.issues[0]?.message ?? "Enter a valid reason");
      return;
    }
    setError(null);
    pendingRef.current = true;
    setPending(true);
    try {
      const result = await cancelBillAction(billId, checked.data);
      if (result.ok) {
        onCancelled(result.data);
        return;
      }
      setError(result.error.message);
    } catch {
      setError("Could not cancel the bill. Try again.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-bill-title"
        noValidate
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            if (!pendingRef.current) onClose();
          }
        }}
        className="w-full max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 id="cancel-bill-title" className="text-lg font-semibold">
          Cancel this bill?
        </h2>
        <p className="text-sm text-gray-700">
          The bill and its numbers stay on record, marked CANCELLED. This cannot be undone.
        </p>
        <div className="space-y-1">
          <label htmlFor="cancel-reason" className="block text-sm font-medium">
            Reason for cancelling
          </label>
          <textarea
            id="cancel-reason"
            autoFocus
            rows={3}
            value={reason}
            disabled={pending}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "cancel-reason-error" : undefined}
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
          {error && (
            <p id="cancel-reason-error" role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className={`${BUTTON} flex-1 border border-gray-300 hover:bg-gray-100`}
          >
            Keep bill
          </button>
          <button
            type="submit"
            disabled={pending}
            className={`${BUTTON} flex-1 bg-red-700 text-white hover:bg-red-800`}
          >
            {pending ? "Cancelling…" : "Confirm cancel"}
          </button>
        </div>
      </form>
    </div>
  );
}
