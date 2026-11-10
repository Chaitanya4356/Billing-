"use client";

import { useState, type KeyboardEvent } from "react";
import type { Totals } from "@/modules/billing/calc";
import type { CartLine } from "@/modules/billing/cart";
import { formatPaise } from "@/lib/money";
import { bpToPercentInput } from "@/modules/shop/form-parse";
import type { BillingConfig } from "@/modules/shop/service";

export type DiscountType = "FLAT" | "PERCENT";

export interface DiscountControl {
  /** Types the signed-in user may use (cashiers: only those with a limit above 0). Empty: no discounts. */
  allowedTypes: DiscountType[];
  type: DiscountType;
  text: string;
  /** Parse error for the typed text, or the server's DISCOUNT_LIMIT message. */
  error: string | null;
  /** Cashier limit hint, or null for owners. */
  hint: string | null;
  onTypeChange: (type: DiscountType) => void;
  onTextChange: (text: string) => void;
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <dt className="text-gray-600">{label}</dt>
      <dd className="tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/** Quantity box: typing edits a draft; Enter or leaving the field applies it, Esc reverts. */
function QtyInput({
  name,
  quantity,
  disabled,
  onCommit,
}: {
  name: string;
  quantity: number;
  disabled: boolean;
  onCommit: (quantity: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const t = draft.trim();
    if (/^\d{1,3}$/.test(t) && Number(t) >= 1) onCommit(Number(t));
    setDraft(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      if (draft !== null) {
        // Apply the typed quantity first; a Ctrl+Enter here must not charge
        // the old quantity, so it is swallowed (press it again to charge).
        e.preventDefault();
        e.stopPropagation();
        commit();
      }
    } else if (e.key === "Escape" && draft !== null) {
      e.stopPropagation();
      setDraft(null);
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={`Quantity of ${name}`}
      value={draft ?? String(quantity)}
      disabled={disabled}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      className="h-11 w-12 rounded border border-gray-300 text-center tabular-nums disabled:bg-gray-100"
    />
  );
}

export function CartPanel({
  lines,
  unavailableIds,
  totals,
  config,
  discountControl,
  appliedDiscount,
  disabled,
  onSetQuantity,
  onRemove,
}: {
  lines: CartLine[];
  unavailableIds: Set<string>;
  totals: Totals | null;
  config: BillingConfig;
  discountControl: DiscountControl;
  appliedDiscount: { type: DiscountType; value: number } | null;
  disabled: boolean;
  onSetQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
}) {
  const empty = lines.length === 0;
  const invalidTotal = !empty && totals === null;
  const rate = bpToPercentInput(config.gstRateBp);
  const dc = discountControl;

  return (
    <section id="cart" aria-label="Cart" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Cart</h2>

      {empty ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-600">
          Tap a product to start a bill.
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
          {lines.map((l) => (
            <li key={l.productId} className="flex flex-wrap items-center gap-2 p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{l.name}</p>
                <p className="text-sm text-gray-600 tabular-nums">
                  {formatPaise(l.unitPricePaise)} × {l.quantity} = {formatPaise(l.unitPricePaise * l.quantity)}
                </p>
                {unavailableIds.has(l.productId) && (
                  <p className="text-sm font-medium text-red-700">No longer available. Remove it to continue.</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Decrease ${l.name}`}
                  disabled={disabled}
                  onClick={() => onSetQuantity(l.productId, l.quantity - 1)}
                  className="h-11 w-11 rounded border border-gray-300 text-lg font-semibold hover:bg-gray-100 disabled:opacity-50"
                >
                  −
                </button>
                <QtyInput
                  name={l.name}
                  quantity={l.quantity}
                  disabled={disabled}
                  onCommit={(q) => onSetQuantity(l.productId, q)}
                />
                <button
                  type="button"
                  aria-label={`Increase ${l.name}`}
                  disabled={disabled}
                  onClick={() => onSetQuantity(l.productId, l.quantity + 1)}
                  className="h-11 w-11 rounded border border-gray-300 text-lg font-semibold hover:bg-gray-100 disabled:opacity-50"
                >
                  +
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${l.name}`}
                  disabled={disabled}
                  onClick={() => onRemove(l.productId)}
                  className="h-11 min-w-11 rounded px-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-800">Discount</span>
        {dc.allowedTypes.length === 0 ? (
          appliedDiscount ? (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-amber-800">A discount is applied that you are not allowed to give.</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => dc.onTextChange("")}
                className="min-h-11 rounded px-3 font-medium text-red-700 hover:bg-red-50"
              >
                Remove discount
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-600">Discounts are not allowed for cashiers. Ask the owner.</p>
          )
        ) : (
          <>
            <div className="flex gap-2">
              <div role="group" aria-label="Discount type" className="flex shrink-0 overflow-hidden rounded border border-gray-300">
                {dc.allowedTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={dc.type === t}
                    aria-label={t === "FLAT" ? "Flat discount (₹)" : "Percent discount"}
                    disabled={disabled}
                    onClick={() => dc.onTypeChange(t)}
                    className={`min-h-11 min-w-11 px-3 font-medium ${
                      dc.type === t ? "bg-gray-900 text-white" : "bg-white text-gray-800 hover:bg-gray-100"
                    }`}
                  >
                    {t === "FLAT" ? "₹" : "%"}
                  </button>
                ))}
              </div>
              <label htmlFor="discount-amount" className="sr-only">
                Discount amount
              </label>
              <input
                id="discount-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={dc.text}
                disabled={disabled}
                onChange={(e) => dc.onTextChange(e.target.value)}
                placeholder={dc.type === "FLAT" ? "Amount in ₹" : "Percent"}
                aria-invalid={dc.error ? true : undefined}
                aria-describedby={dc.error ? "discount-error" : dc.hint ? "discount-hint" : undefined}
                className="min-h-11 min-w-0 flex-1 rounded border border-gray-300 px-3 tabular-nums disabled:bg-gray-100"
              />
            </div>
            {dc.hint && (
              <p id="discount-hint" className="text-xs text-gray-600">
                {dc.hint}
              </p>
            )}
            {dc.error && (
              <p id="discount-error" role="alert" className="text-sm text-red-700">
                {dc.error}
              </p>
            )}
          </>
        )}
      </div>

      <dl className="flex flex-col gap-1 border-t border-gray-200 pt-3">
        {totals && (
          <>
            <Row label="Subtotal" value={formatPaise(totals.subtotalPaise)} />
            {totals.discountPaise > 0 && (
              <Row
                label={appliedDiscount?.type === "PERCENT" ? `Discount (${bpToPercentInput(appliedDiscount.value)}%)` : "Discount"}
                value={`−${formatPaise(totals.discountPaise)}`}
              />
            )}
            {config.gstEnabled &&
              (config.gstInclusive ? (
                <Row label={`Includes GST ${rate}%`} value={formatPaise(totals.taxPaise)} />
              ) : (
                <Row label={`GST ${rate}%`} value={formatPaise(totals.taxPaise)} />
              ))}
            {totals.roundOffPaise !== 0 && (
              <Row
                label="Round off"
                value={`${totals.roundOffPaise > 0 ? "+" : "−"}${formatPaise(Math.abs(totals.roundOffPaise))}`}
              />
            )}
          </>
        )}
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <dt className="text-base font-semibold tracking-wide uppercase">Payable</dt>
          <dd
            data-testid="payable-amount"
            aria-live="polite"
            aria-atomic="true"
            className="text-4xl font-bold tabular-nums"
          >
            {totals ? formatPaise(totals.totalPaise) : empty ? formatPaise(0) : "—"}
          </dd>
        </div>
        {invalidTotal && (
          <p role="alert" className="text-sm text-red-700">
            This bill cannot be charged. Check the discount and quantities (the total must be above ₹0).
          </p>
        )}
      </dl>
    </section>
  );
}
