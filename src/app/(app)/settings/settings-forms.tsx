"use client";

import { rupeesToPaise } from "@/lib/money";
import {
  bpToPercentInput,
  paiseToRupeeInput,
  parseZeroablePercentBp,
} from "@/modules/shop/form-parse";
import type { ShopInfo, ShopSettingsRow } from "@/modules/shop/service";
import {
  buildResult,
  CheckboxField,
  checked,
  SelectField,
  SettingsForm,
  text,
  TextAreaField,
  TextField,
  useSettingsForm,
  type FieldErrors,
} from "./form-kit";

export function ShopForm({ shop }: { shop: ShopInfo }) {
  const form = useSettingsForm((d) =>
    buildResult({
      name: text(d, "name"),
      address: text(d, "address"),
      phone: text(d, "phone"),
      gstin: text(d, "gstin").trim().toUpperCase(),
    }),
  );
  const { errors } = form;
  return (
    <SettingsForm form={form}>
      <TextField id="name" label="Shop name" defaultValue={shop.name} maxLength={80} error={errors.name} />
      <TextAreaField id="address" label="Address" defaultValue={shop.address} maxLength={300} error={errors.address} />
      <TextField id="phone" label="Phone" defaultValue={shop.phone} maxLength={20} inputMode="text" error={errors.phone} />
      <TextField
        id="gstin"
        label="GSTIN"
        hint="Optional. 15 characters, for example 27AAPFU0939F1ZV."
        defaultValue={shop.gstin ?? ""}
        maxLength={15}
        upper
        error={errors.gstin}
      />
    </SettingsForm>
  );
}

export function NumberingForm({ settings }: { settings: ShopSettingsRow }) {
  const form = useSettingsForm((d) => {
    const hour = text(d, "dayStartHour").trim();
    const parseErrors: FieldErrors = {};
    if (!/^\d{1,2}$/.test(hour)) parseErrors.dayStartHour = "Enter an hour from 0 to 23";
    return buildResult(
      {
        billPrefix: text(d, "billPrefix").trim().toUpperCase(),
        tokenResetMode: text(d, "tokenResetMode") as "DAILY" | "NEVER",
        dayStartHour: Number(hour),
      },
      parseErrors,
    );
  });
  const { errors } = form;
  return (
    <SettingsForm form={form}>
      <TextField
        id="billPrefix"
        label="Bill prefix"
        hint="1 to 6 capital letters or digits."
        defaultValue={settings.billPrefix}
        maxLength={6}
        upper
        error={errors.billPrefix}
      />
      <SelectField
        id="tokenResetMode"
        label="Token numbers restart"
        defaultValue={settings.tokenResetMode}
        options={[
          { value: "DAILY", label: "Every day" },
          { value: "NEVER", label: "Never" },
        ]}
      />
      <TextField
        id="dayStartHour"
        label="Business day starts at (hour, 0-23)"
        hint="Bills before this hour count towards the previous day."
        defaultValue={String(settings.dayStartHour)}
        maxLength={2}
        inputMode="numeric"
        error={errors.dayStartHour}
      />
    </SettingsForm>
  );
}

export function GstForm({ settings }: { settings: ShopSettingsRow }) {
  const form = useSettingsForm((d) => {
    const parseErrors: FieldErrors = {};
    const rate = parseZeroablePercentBp(text(d, "gstRateBp"));
    if (rate === null) parseErrors.gstRateBp = "Enter a rate from 0 to 100, up to 2 decimals";
    return buildResult(
      {
        gstEnabled: checked(d, "gstEnabled"),
        gstRateBp: rate ?? 0,
        gstInclusive: checked(d, "gstInclusive"),
        roundToRupee: checked(d, "roundToRupee"),
      },
      parseErrors,
    );
  });
  const { errors } = form;
  return (
    <SettingsForm form={form}>
      <CheckboxField id="gstEnabled" label="Charge GST on bills" defaultChecked={settings.gstEnabled} />
      <TextField
        id="gstRateBp"
        label="GST rate (%)"
        defaultValue={bpToPercentInput(settings.gstRateBp)}
        maxLength={6}
        inputMode="decimal"
        className="max-w-40"
        error={errors.gstRateBp}
      />
      <CheckboxField id="gstInclusive" label="Prices include GST" defaultChecked={settings.gstInclusive} />
      <CheckboxField id="roundToRupee" label="Round bill total to the nearest rupee" defaultChecked={settings.roundToRupee} />
    </SettingsForm>
  );
}

export function DiscountsForm({ settings }: { settings: ShopSettingsRow }) {
  const form = useSettingsForm((d) => {
    const parseErrors: FieldErrors = {};
    const flat = rupeesToPaise(text(d, "cashierDiscountMaxFlatPaise"));
    if (flat === null) parseErrors.cashierDiscountMaxFlatPaise = "Enter an amount in rupees, up to 2 decimals";
    const pct = parseZeroablePercentBp(text(d, "cashierDiscountMaxPctBp"));
    if (pct === null) parseErrors.cashierDiscountMaxPctBp = "Enter a percent from 0 to 100, up to 2 decimals";
    return buildResult(
      {
        cashierDiscountMaxFlatPaise: flat ?? 0,
        cashierDiscountMaxPctBp: pct ?? 0,
        cashierCanCancel: checked(d, "cashierCanCancel"),
      },
      parseErrors,
    );
  });
  const { errors } = form;
  return (
    <SettingsForm form={form}>
      <p className="text-sm text-gray-600">Owners can always discount and cancel. Use 0 to stop cashiers discounting.</p>
      <TextField
        id="cashierDiscountMaxFlatPaise"
        label="Cashier flat discount limit (₹)"
        defaultValue={paiseToRupeeInput(settings.cashierDiscountMaxFlatPaise)}
        maxLength={12}
        inputMode="decimal"
        className="max-w-40"
        error={errors.cashierDiscountMaxFlatPaise}
      />
      <TextField
        id="cashierDiscountMaxPctBp"
        label="Cashier percent discount limit (%)"
        defaultValue={bpToPercentInput(settings.cashierDiscountMaxPctBp)}
        maxLength={6}
        inputMode="decimal"
        className="max-w-40"
        error={errors.cashierDiscountMaxPctBp}
      />
      <CheckboxField id="cashierCanCancel" label="Cashiers can cancel bills" defaultChecked={settings.cashierCanCancel} />
    </SettingsForm>
  );
}

export function ReceiptForm({ settings }: { settings: ShopSettingsRow }) {
  const form = useSettingsForm((d) =>
    buildResult({
      receiptTitle: text(d, "receiptTitle"),
      receiptHeader: text(d, "receiptHeader"),
      receiptFooter: text(d, "receiptFooter"),
      paperWidth: text(d, "paperWidth") === "58" ? 58 : 80,
    }),
  );
  const { errors } = form;
  return (
    <SettingsForm form={form}>
      <TextField id="receiptTitle" label="Receipt title" defaultValue={settings.receiptTitle} maxLength={60} error={errors.receiptTitle} />
      <TextAreaField id="receiptHeader" label="Receipt header" defaultValue={settings.receiptHeader} maxLength={200} error={errors.receiptHeader} />
      <TextAreaField id="receiptFooter" label="Receipt footer" defaultValue={settings.receiptFooter} maxLength={200} error={errors.receiptFooter} />
      <SelectField
        id="paperWidth"
        label="Paper width"
        defaultValue={String(settings.paperWidth)}
        options={[
          { value: "58", label: "58 mm" },
          { value: "80", label: "80 mm" },
        ]}
      />
    </SettingsForm>
  );
}
