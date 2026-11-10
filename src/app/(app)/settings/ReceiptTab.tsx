"use client";

import { useMemo, useState } from "react";
import { printReceiptHtml } from "@/modules/printing/print-client";
import { renderReceiptHtml } from "@/modules/printing/render-html";
import { sampleReceiptData } from "@/modules/printing/sample";
import type { ShopInfo, ShopSettingsRow } from "@/modules/shop/service";
import {
  buildResult,
  SelectField,
  SettingsForm,
  text,
  TextAreaField,
  TextField,
  useSettingsForm,
} from "@/components/form-kit";

/**
 * Receipt settings with a live preview. The preview and Test Print are built
 * client-side from the (possibly unsaved) form values; they never touch the server.
 */
export function ReceiptTab({ shop, settings }: { shop: ShopInfo; settings: ShopSettingsRow }) {
  const form = useSettingsForm((d) =>
    buildResult({
      receiptTitle: text(d, "receiptTitle"),
      receiptHeader: text(d, "receiptHeader"),
      receiptFooter: text(d, "receiptFooter"),
      paperWidth: text(d, "paperWidth") === "58" ? 58 : 80,
    }),
  );
  const { errors } = form;

  const [title, setTitle] = useState(settings.receiptTitle);
  const [header, setHeader] = useState(settings.receiptHeader);
  const [footer, setFooter] = useState(settings.receiptFooter);
  const [paperWidth, setPaperWidth] = useState<58 | 80>(settings.paperWidth === 58 ? 58 : 80);
  const [printError, setPrintError] = useState<string | null>(null);

  const html = useMemo(
    () =>
      renderReceiptHtml(
        sampleReceiptData(
          { name: shop.name, address: shop.address, phone: shop.phone, gstin: shop.gstin },
          { header, footer },
          {
            receiptTitle: title,
            gstEnabled: settings.gstEnabled,
            gstRateBp: settings.gstRateBp,
            gstInclusive: settings.gstInclusive,
          },
        ),
        paperWidth,
      ),
    [shop, settings.gstEnabled, settings.gstRateBp, settings.gstInclusive, title, header, footer, paperWidth],
  );

  async function testPrint() {
    setPrintError(null);
    try {
      await printReceiptHtml(html);
    } catch (e) {
      setPrintError(e instanceof Error ? e.message : "Printing failed");
    }
  }

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <SettingsForm form={form}>
          <TextField
            id="receiptTitle"
            label="Receipt title"
            defaultValue={settings.receiptTitle}
            maxLength={60}
            error={errors.receiptTitle}
            onValueChange={setTitle}
          />
          <TextAreaField
            id="receiptHeader"
            label="Receipt header"
            defaultValue={settings.receiptHeader}
            maxLength={200}
            error={errors.receiptHeader}
            onValueChange={setHeader}
          />
          <TextAreaField
            id="receiptFooter"
            label="Receipt footer"
            defaultValue={settings.receiptFooter}
            maxLength={200}
            error={errors.receiptFooter}
            onValueChange={setFooter}
          />
          <SelectField
            id="paperWidth"
            label="Paper width"
            defaultValue={String(paperWidth)}
            options={[
              { value: "58", label: "58 mm" },
              { value: "80", label: "80 mm" },
            ]}
            onValueChange={(v) => setPaperWidth(v === "58" ? 58 : 80)}
          />
        </SettingsForm>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium">Preview</h2>
        <p className="text-xs text-gray-500">
          A sample receipt. It updates as you edit and is not saved until you press Save.
        </p>
        <iframe
          title="Receipt preview"
          sandbox=""
          srcDoc={html}
          style={{ width: `${paperWidth}mm`, height: "520px" }}
          className="block max-w-full border border-gray-300 bg-white shadow-sm"
        />
        <button
          type="button"
          onClick={testPrint}
          className="min-h-11 rounded border border-gray-300 px-4 font-medium hover:bg-gray-50"
        >
          Test Print
        </button>
        <p className="text-xs text-gray-500">Prints the sample above. No bill is created.</p>
        {printError ? (
          <p role="alert" className="text-sm text-red-600">
            {printError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
