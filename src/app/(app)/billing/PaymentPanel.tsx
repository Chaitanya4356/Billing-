"use client";

import { formatPaise } from "@/lib/money";

export type PaymentMethod = "CASH" | "UPI";

const QUICK_NOTES_RUPEES = [50, 100, 200, 500] as const;

export function PaymentPanel({
  method,
  onMethodChange,
  totalPaise,
  cashText,
  onCashTextChange,
  onExact,
  onQuickNote,
  cashError,
  cashShort,
  changeDuePaise,
  upiReceived,
  upiNeedsReconfirm,
  onUpiReceivedChange,
  upiReference,
  onUpiReferenceChange,
  customerOpen,
  onToggleCustomer,
  customerName,
  onCustomerNameChange,
  customerPhone,
  onCustomerPhoneChange,
  phoneError,
  notice,
  error,
  canCharge,
  pending,
  disabled,
  onCharge,
}: {
  method: PaymentMethod;
  onMethodChange: (m: PaymentMethod) => void;
  totalPaise: number | null;
  cashText: string;
  onCashTextChange: (text: string) => void;
  onExact: () => void;
  onQuickNote: (rupees: number) => void;
  cashError: string | null;
  cashShort: boolean;
  changeDuePaise: number | null;
  upiReceived: boolean;
  upiNeedsReconfirm: boolean;
  onUpiReceivedChange: (checked: boolean) => void;
  upiReference: string;
  onUpiReferenceChange: (text: string) => void;
  customerOpen: boolean;
  onToggleCustomer: () => void;
  customerName: string;
  onCustomerNameChange: (text: string) => void;
  customerPhone: string;
  onCustomerPhoneChange: (text: string) => void;
  phoneError: string | null;
  /** Non-blocking information (e.g. prices changed). */
  notice: string | null;
  /** Error from the last charge attempt that belongs to no single field. */
  error: string | null;
  canCharge: boolean;
  pending: boolean;
  /** Inputs are locked (a charge is in flight). */
  disabled: boolean;
  onCharge: () => void;
}) {
  const methodButton = (m: PaymentMethod, label: string) => (
    <button
      type="button"
      aria-pressed={method === m}
      disabled={disabled}
      onClick={() => onMethodChange(m)}
      className={`min-h-12 flex-1 text-base font-semibold ${
        method === m ? "bg-gray-900 text-white" : "bg-white text-gray-800 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );

  return (
    <section aria-label="Payment" className="flex flex-col gap-3 border-t border-gray-200 pt-3">
      <div role="group" aria-label="Payment method" className="flex overflow-hidden rounded-lg border border-gray-300">
        {methodButton("CASH", "Cash")}
        {methodButton("UPI", "UPI")}
      </div>

      {method === "CASH" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="cash-received" className="text-sm font-medium text-gray-800">
            Cash received (₹)
          </label>
          <input
            id="cash-received"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={cashText}
            disabled={disabled}
            onChange={(e) => onCashTextChange(e.target.value)}
            aria-invalid={cashError || cashShort ? true : undefined}
            aria-describedby="cash-feedback"
            className="min-h-12 rounded border border-gray-300 px-3 text-lg tabular-nums disabled:bg-gray-100"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || totalPaise === null}
              onClick={onExact}
              className="min-h-11 rounded border border-gray-300 px-3 font-medium hover:bg-gray-100 disabled:opacity-50"
            >
              Exact
            </button>
            {QUICK_NOTES_RUPEES.map((r) => (
              <button
                key={r}
                type="button"
                disabled={disabled}
                onClick={() => onQuickNote(r)}
                className="min-h-11 rounded border border-gray-300 px-3 font-medium tabular-nums hover:bg-gray-100 disabled:opacity-50"
              >
                ₹{r}
              </button>
            ))}
          </div>
          <div id="cash-feedback">
            {cashError ? (
              <p role="alert" className="text-sm text-red-700">
                {cashError}
              </p>
            ) : cashShort ? (
              <p role="alert" className="text-sm text-red-700">
                Cash received is less than the payable amount.
              </p>
            ) : changeDuePaise !== null ? (
              <p className="text-base">
                Change due:{" "}
                <span data-testid="change-due" className="font-semibold tabular-nums">
                  {formatPaise(changeDuePaise)}
                </span>
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex min-h-11 items-center gap-3 text-base font-medium">
            <input
              type="checkbox"
              checked={upiReceived}
              disabled={disabled || totalPaise === null}
              onChange={(e) => onUpiReceivedChange(e.target.checked)}
              className="h-6 w-6"
            />
            Payment received
            {totalPaise !== null && <span className="text-gray-600 tabular-nums">({formatPaise(totalPaise)})</span>}
          </label>
          {upiNeedsReconfirm && (
            <p className="text-sm text-amber-800">The total changed. Confirm the UPI payment again.</p>
          )}
          <label htmlFor="upi-reference" className="text-sm font-medium text-gray-800">
            UPI reference (optional)
          </label>
          <input
            id="upi-reference"
            type="text"
            maxLength={40}
            autoComplete="off"
            value={upiReference}
            disabled={disabled}
            onChange={(e) => onUpiReferenceChange(e.target.value)}
            className="min-h-11 rounded border border-gray-300 px-3 disabled:bg-gray-100"
          />
        </div>
      )}

      <div>
        <button
          type="button"
          aria-expanded={customerOpen}
          aria-controls="customer-fields"
          onClick={onToggleCustomer}
          className="min-h-11 text-sm font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900"
        >
          {customerOpen ? "Hide customer details" : "Add customer details"}
        </button>
        {customerOpen && (
          <div id="customer-fields" className="mt-1 flex flex-col gap-2">
            <label htmlFor="customer-name" className="text-sm font-medium text-gray-800">
              Customer name
            </label>
            <input
              id="customer-name"
              type="text"
              maxLength={60}
              autoComplete="off"
              value={customerName}
              disabled={disabled}
              onChange={(e) => onCustomerNameChange(e.target.value)}
              className="min-h-11 rounded border border-gray-300 px-3 disabled:bg-gray-100"
            />
            <label htmlFor="customer-phone" className="text-sm font-medium text-gray-800">
              Customer phone
            </label>
            <input
              id="customer-phone"
              type="tel"
              maxLength={20}
              autoComplete="off"
              value={customerPhone}
              disabled={disabled}
              onChange={(e) => onCustomerPhoneChange(e.target.value)}
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? "customer-phone-error" : undefined}
              className="min-h-11 rounded border border-gray-300 px-3 disabled:bg-gray-100"
            />
            {phoneError && (
              <p id="customer-phone-error" role="alert" className="text-sm text-red-700">
                {phoneError}
              </p>
            )}
          </div>
        )}
      </div>

      <div role="status" aria-live="polite">
        {notice && <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
      </div>
      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={!canCharge || pending}
        aria-keyshortcuts="Control+Enter"
        onClick={onCharge}
        className="min-h-16 rounded-xl bg-green-700 px-4 text-xl font-bold text-white shadow hover:bg-green-800 disabled:bg-gray-300 disabled:text-gray-600"
      >
        {pending ? "Charging…" : totalPaise !== null ? `Charge ${formatPaise(totalPaise)}` : "Charge"}
      </button>
    </section>
  );
}
