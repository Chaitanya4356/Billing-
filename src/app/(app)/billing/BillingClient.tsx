"use client";

import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import type { ErrorCode } from "@/lib/errors";
import { formatPaise, rupeesToPaise } from "@/lib/money";
import type { Role } from "@/lib/types";
import { createBillAction, refreshBillingDataAction } from "@/modules/billing/actions";
import { cartReducer, initialCart, selectTotals, type CartAction, type CartState } from "@/modules/billing/cart";
import {
  buildCreateBillInput,
  newIdempotencyKey,
  parseCashText,
  parseDiscountText,
  type PaymentDraft,
} from "@/modules/billing/screen";
import type { BillDetail } from "@/modules/bills/types";
import { bpToPercentInput, paiseToRupeeInput } from "@/modules/shop/form-parse";
import type { BillingConfig } from "@/modules/shop/service";
import { CartPanel, type DiscountControl, type DiscountType } from "./CartPanel";
import { PaymentPanel, type PaymentMethod } from "./PaymentPanel";
import { ALL_CATEGORIES, ProductGrid } from "./ProductGrid";
import { SuccessScreen } from "./SuccessScreen";

export interface BillingCategory {
  id: string;
  name: string;
}

export interface BillingProduct {
  id: string;
  name: string;
  pricePaise: number;
  shortCode: string | null;
  categoryId: string;
}

export const PRICE_CHANGED_MESSAGE = "Prices or tax settings changed. Please review the new total and charge again.";
const NETWORK_ERROR_MESSAGE =
  "Could not reach the server, so the bill may or may not have been saved. Press Charge again: the same bill is never saved twice.";
/** createBillSchema's message for a phone number it cannot normalise. */
const INVALID_PHONE_MESSAGE = "Enter a valid phone number";

type ErrorField = "discount" | "phone" | "cash" | "general";
interface ChargeError {
  field: ErrorField;
  message: string;
}

function errorField(code: ErrorCode, message: string): ErrorField {
  if (code === "DISCOUNT_LIMIT") return "discount";
  if (code === "INSUFFICIENT_CASH") return "cash";
  if (code === "VALIDATION" && message === INVALID_PHONE_MESSAGE) return "phone";
  return "general";
}

function cartReducerWithKeys(state: CartState, action: CartAction): CartState {
  return cartReducer(state, action, newIdempotencyKey);
}

function allowedDiscountTypes(role: Role, config: BillingConfig): DiscountType[] {
  if (role === "OWNER") return ["FLAT", "PERCENT"];
  const types: DiscountType[] = [];
  if (config.cashierDiscountMaxFlatPaise > 0) types.push("FLAT");
  if (config.cashierDiscountMaxPctBp > 0) types.push("PERCENT");
  return types;
}

function cashierLimitHint(role: Role, config: BillingConfig): string | null {
  if (role === "OWNER") return null;
  const parts: string[] = [];
  if (config.cashierDiscountMaxFlatPaise > 0) parts.push(`${formatPaise(config.cashierDiscountMaxFlatPaise)} flat`);
  if (config.cashierDiscountMaxPctBp > 0) parts.push(`${bpToPercentInput(config.cashierDiscountMaxPctBp)}%`);
  return parts.length > 0 ? `Your limit: up to ${parts.join(" or ")}. Larger discounts need the owner.` : null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

export function BillingClient({
  role,
  initialConfig,
  categories,
  initialProducts,
}: {
  role: Role;
  initialConfig: BillingConfig;
  categories: BillingCategory[];
  initialProducts: BillingProduct[];
}) {
  // The cart (with its idempotency key) lives only in the browser; a new key
  // is generated on mount and on RESET (New Bill / clear cart).
  const [cart, rawDispatch] = useReducer(cartReducerWithKeys, undefined, () => initialCart(newIdempotencyKey));
  const [config, setConfig] = useState(initialConfig);
  const [products, setProducts] = useState(initialProducts);

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState(ALL_CATEGORIES);

  const [discountType, setDiscountType] = useState<DiscountType>("FLAT");
  const [discountText, setDiscountText] = useState("");

  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [cashText, setCashText] = useState("");
  /** The payable total the cashier confirmed UPI for; a different total needs a new confirmation. */
  const [upiConfirmedTotal, setUpiConfirmedTotal] = useState<number | null>(null);
  const [upiReference, setUpiReference] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const [pending, setPending] = useState(false);
  /** Synchronous double-submit guard: set before the request, cleared after it settles. */
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [chargeError, setChargeError] = useState<ChargeError | null>(null);
  const [success, setSuccess] = useState<{ bill: BillDetail; warning: string | null } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [focusSearchTick, setFocusSearchTick] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const keepItemsRef = useRef<HTMLButtonElement>(null);

  // ------------------------------------------------------------ derived state
  const locked = pending || success !== null;
  const totals = selectTotals(cart, config);
  const totalPaise = totals?.totalPaise ?? null;

  const allowedTypes = allowedDiscountTypes(role, config);
  const effectiveDiscountType = allowedTypes.includes(discountType) ? discountType : (allowedTypes[0] ?? "FLAT");
  const discountParse = parseDiscountText(effectiveDiscountType, discountText);
  const discountParseError = discountParse.ok ? null : discountParse.error;

  const cashParse = parseCashText(cashText);
  const cashPaise = cashParse.ok ? cashParse.paise : null;
  const cashError = cashParse.ok ? (chargeError?.field === "cash" ? chargeError.message : null) : cashParse.error;
  const cashShort = cashPaise !== null && totalPaise !== null && cashPaise < totalPaise;
  const changeDuePaise = cashPaise !== null && totalPaise !== null && cashPaise >= totalPaise ? cashPaise - totalPaise : null;

  const upiReceived = upiConfirmedTotal !== null && upiConfirmedTotal === totalPaise;
  const upiNeedsReconfirm = upiConfirmedTotal !== null && totalPaise !== null && upiConfirmedTotal !== totalPaise;

  const productIds = new Set(products.map((p) => p.id));
  const unavailableIds = new Set(cart.lines.filter((l) => !productIds.has(l.productId)).map((l) => l.productId));

  const paymentReady =
    method === "CASH" ? cashParse.ok && cashPaise !== null && totalPaise !== null && cashPaise >= totalPaise : upiReceived;
  const canCharge =
    !locked &&
    cart.lines.length > 0 &&
    totals !== null &&
    discountParseError === null &&
    unavailableIds.size === 0 &&
    paymentReady;

  // ----------------------------------------------------------------- actions
  /** Cart changes are ignored while a charge is in flight or the success screen is open. */
  function dispatch(action: CartAction) {
    if (inFlight.current || success) return;
    rawDispatch(action);
  }

  function clearFieldError(field: ErrorField) {
    setChargeError((e) => (e?.field === field ? null : e));
  }

  function applyDiscount(type: DiscountType, text: string) {
    setDiscountType(type);
    setDiscountText(text);
    clearFieldError("discount");
    const parsed = parseDiscountText(type, text);
    // An unparseable entry removes the discount from the total and blocks Charge.
    dispatch({ type: "SET_DISCOUNT", discount: parsed.ok ? parsed.discount : null });
  }

  function resetScreen() {
    rawDispatch({ type: "RESET" });
    setSearch("");
    setCategoryId(ALL_CATEGORIES);
    setDiscountText("");
    setMethod("CASH");
    setCashText("");
    setUpiConfirmedTotal(null);
    setUpiReference("");
    setCustomerOpen(false);
    setCustomerName("");
    setCustomerPhone("");
    setNotice(null);
    setChargeError(null);
    setConfirmClear(false);
    setSuccess(null);
    setFocusSearchTick((n) => n + 1);
  }

  async function refreshAfterPriceChange(): Promise<boolean> {
    const result = await refreshBillingDataAction();
    if (!result.ok) return false;
    const prices: Record<string, number> = {};
    for (const p of result.data.products) prices[p.id] = p.pricePaise;
    rawDispatch({ type: "REFRESH_PRICES", prices });
    setConfig(result.data.config);
    setProducts((prev) =>
      prev
        .filter((p) => Object.prototype.hasOwnProperty.call(prices, p.id))
        .map((p) => (prices[p.id] === p.pricePaise ? p : { ...p, pricePaise: prices[p.id] })),
    );
    return true;
  }

  async function charge() {
    if (inFlight.current || !canCharge || totalPaise === null) return;
    const payment: PaymentDraft =
      method === "CASH" ? { method: "CASH", cashTenderedPaise: cashPaise ?? 0 } : { method: "UPI", reference: upiReference };
    const input = buildCreateBillInput({
      cart,
      displayedTotalPaise: totalPaise,
      payment,
      customerName: customerOpen ? customerName : "",
      customerPhone: customerOpen ? customerPhone : "",
    });

    inFlight.current = true;
    setPending(true);
    setNotice(null);
    setChargeError(null);
    try {
      const result = await createBillAction(input);
      if (result.ok) {
        const bill = result.data;
        // Only possible when an earlier attempt with the same key (e.g. one
        // whose response was lost) was saved: the server returns that bill.
        const warning =
          bill.totalPaise !== input.expectedTotalPaise
            ? `This bill was already saved by an earlier attempt, with a total of ${formatPaise(bill.totalPaise)} (the screen showed ${formatPaise(input.expectedTotalPaise)}). Collect ${formatPaise(bill.totalPaise)}.`
            : null;
        setSuccess({ bill, warning });
        return;
      }
      const { code, message } = result.error;
      if (code === "PRICE_CHANGED") {
        // No bill was created: keep the cart and its key, recalculate from
        // fresh prices and settings, and let the cashier confirm again.
        setUpiConfirmedTotal(null);
        const refreshed = await refreshAfterPriceChange();
        if (refreshed) setNotice(PRICE_CHANGED_MESSAGE);
        else setChargeError({ field: "general", message: `${message} Reload the page to load the new prices.` });
        return;
      }
      if (code === "INVALID_PRODUCT") {
        await refreshAfterPriceChange();
      }
      const field = errorField(code, message);
      if (field === "phone") setCustomerOpen(true);
      setChargeError({ field, message });
    } catch {
      // Unknown outcome: keep the cart and the same key so a retry returns
      // the bill if it was saved.
      setChargeError({ field: "general", message: NETWORK_ERROR_MESSAGE });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  // --------------------------------------------------------------- shortcuts
  const onWindowKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (success) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!confirmClear) void charge();
      return;
    }
    if (e.key === "Escape") {
      if (confirmClear) {
        e.preventDefault();
        setConfirmClear(false);
        setFocusSearchTick((n) => n + 1);
        return;
      }
      if (e.target === searchRef.current && search !== "") {
        setSearch("");
        return;
      }
      if (!pending && cart.lines.length > 0) {
        e.preventDefault();
        setConfirmClear(true);
      }
      return;
    }
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !confirmClear && !isTypingTarget(e.target)) {
      e.preventDefault();
      searchRef.current?.focus();
    }
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onWindowKeyDown(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (focusSearchTick > 0) searchRef.current?.focus();
  }, [focusSearchTick]);

  useEffect(() => {
    if (confirmClear) keepItemsRef.current?.focus();
  }, [confirmClear]);

  // ------------------------------------------------------------------ render
  const discountControl: DiscountControl = {
    allowedTypes,
    type: effectiveDiscountType,
    text: discountText,
    error: discountParseError ?? (chargeError?.field === "discount" ? chargeError.message : null),
    hint: cashierLimitHint(role, config),
    onTypeChange: (t) => applyDiscount(t, ""),
    onTextChange: (text) => applyDiscount(effectiveDiscountType, text),
  };

  return (
    <>
      <div inert={success !== null || confirmClear} className="flex flex-col gap-4 pb-24 lg:pb-0">
        <h1 className="sr-only">Billing</h1>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
          <ProductGrid
            categories={categories}
            products={products}
            search={search}
            onSearchChange={setSearch}
            categoryId={categoryId}
            onCategoryChange={setCategoryId}
            onAdd={(p) => dispatch({ type: "ADD_PRODUCT", product: { id: p.id, name: p.name, pricePaise: p.pricePaise } })}
            searchRef={searchRef}
            disabled={locked}
          />
          <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:rounded-xl lg:border lg:border-gray-200 lg:p-4">
            <CartPanel
              lines={cart.lines}
              unavailableIds={unavailableIds}
              totals={totals}
              config={config}
              discountControl={discountControl}
              appliedDiscount={cart.discount}
              disabled={locked}
              onSetQuantity={(productId, quantity) => dispatch({ type: "SET_QUANTITY", productId, quantity })}
              onRemove={(productId) => dispatch({ type: "REMOVE", productId })}
            />
            <PaymentPanel
              method={method}
              onMethodChange={setMethod}
              totalPaise={totalPaise}
              cashText={cashText}
              onCashTextChange={(t) => {
                setCashText(t);
                clearFieldError("cash");
              }}
              onExact={() => {
                if (totalPaise === null) return;
                setCashText(paiseToRupeeInput(totalPaise));
                clearFieldError("cash");
              }}
              onQuickNote={(r) => {
                const paise = rupeesToPaise(String(r));
                if (paise === null) return;
                setCashText(paiseToRupeeInput(paise));
                clearFieldError("cash");
              }}
              cashError={cashError}
              cashShort={cashShort}
              changeDuePaise={changeDuePaise}
              upiReceived={upiReceived}
              upiNeedsReconfirm={upiNeedsReconfirm}
              onUpiReceivedChange={(checked) => setUpiConfirmedTotal(checked ? totalPaise : null)}
              upiReference={upiReference}
              onUpiReferenceChange={setUpiReference}
              customerOpen={customerOpen}
              onToggleCustomer={() => setCustomerOpen((o) => !o)}
              customerName={customerName}
              onCustomerNameChange={setCustomerName}
              customerPhone={customerPhone}
              onCustomerPhoneChange={(t) => {
                setCustomerPhone(t);
                clearFieldError("phone");
              }}
              phoneError={chargeError?.field === "phone" ? chargeError.message : null}
              notice={notice}
              error={chargeError?.field === "general" ? chargeError.message : null}
              canCharge={canCharge}
              pending={pending}
              disabled={locked}
              onCharge={() => void charge()}
            />
          </div>
        </div>

        {/* Narrow screens: the cart sits below the products; this bar jumps to it. */}
        <a
          href="#cart"
          className="fixed inset-x-0 bottom-0 z-40 flex min-h-14 items-center justify-between gap-3 border-t border-gray-300 bg-white px-4 text-base font-semibold shadow-lg lg:hidden"
        >
          <span>
            Cart · {cart.lines.reduce((n, l) => n + l.quantity, 0)} item(s)
          </span>
          <span className="tabular-nums">{formatPaise(totalPaise ?? 0)}</span>
        </a>
      </div>

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-cart-title"
            aria-describedby="clear-cart-desc"
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
          >
            <h2 id="clear-cart-title" className="text-lg font-semibold">
              Clear the cart?
            </h2>
            <p id="clear-cart-desc" className="mt-1 text-sm text-gray-700">
              All items, the discount and the payment details of this bill will be removed.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                ref={keepItemsRef}
                type="button"
                onClick={() => {
                  setConfirmClear(false);
                  setFocusSearchTick((n) => n + 1);
                }}
                className="min-h-11 flex-1 rounded-lg border border-gray-300 font-medium hover:bg-gray-100"
              >
                Keep items
              </button>
              <button
                type="button"
                onClick={resetScreen}
                className="min-h-11 flex-1 rounded-lg bg-red-700 font-medium text-white hover:bg-red-800"
              >
                Clear cart
              </button>
            </div>
          </div>
        </div>
      )}

      {success && <SuccessScreen bill={success.bill} warning={success.warning} onNewBill={resetScreen} />}
    </>
  );
}
