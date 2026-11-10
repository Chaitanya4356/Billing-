# Printer test checklist

Do this once on the **real shop PC with the real receipt printer**, before go-live, and again whenever the printer,
the driver, the paper roll width or the browser changes. Tick each box as you go and fill in the results table at the
end. It takes about 20 minutes per paper width. Related: [runbook.md](./runbook.md) (section 6 covers the optional
`--kiosk-printing` shortcut).

Use Chrome or Edge on the shop PC, signed in as the owner. Keep a few spare paper rolls at hand.

## 1. Record the printer

- [ ] Printer make and model: ______________________________
- [ ] Connection: USB / LAN (circle one)
- [ ] Windows driver name (Settings > Printers & scanners > the printer > Printer properties): ______________________
- [ ] Paper roll width(s) in use: 58 mm / 80 mm (circle all that apply)
- [ ] The printer is switched on, has paper, and Windows prints its own test page correctly.

## 2. Set the Windows driver paper size (zero margins)

Do this for each paper width you use. Printer properties > Printing preferences (names vary by driver).

- [ ] 58 mm: choose the 58 mm roll paper size (for example "58mm x Receipt" or a custom 58 mm wide size).
- [ ] 80 mm: choose the 80 mm roll paper size (for example "80mm x Receipt" or a custom 80 mm wide size).
- [ ] Margins are **zero** (or the smallest the driver allows) on all four sides.
- [ ] Cut mode is set to cut after each document (if the printer has a cutter).

## 3. Test Print (no bill is created)

Go to **Settings > Receipt**. Choose **Paper width** (58 mm or 80 mm) to match the roll in the printer, then press
**Test Print**. In the browser print dialog pick the receipt printer and, under More settings, set Margins to
**None** and **untick Headers and footers**. Test Print uses the values on the screen even if they are not saved yet,
and never creates a bill or uses a token. Press **Save** afterwards so the real receipts use the same width.

Check the paper that comes out:

- [ ] The token number is readable at a glance (large and bold).
- [ ] Nothing is clipped on the left or right edge.
- [ ] No browser header or footer (date, page title, web address, page numbers) is printed.
- [ ] A long product name wraps onto the next line cleanly (try one with 30+ characters; the quantity and amount stay
      aligned and are not cut off).
- [ ] The ₹ symbol prints as ₹ (not a box, a question mark or "Rs").
- [ ] If GST is on: the GST lines and the total line are aligned with the item amounts.
- [ ] The paper is cut after the last line, with no large blank strip and no last line lost in the cut.

## 4. A real test bill

Charge a small bill (for example one cheap product, cash, Exact). Remember: it is a real bill and will appear in
reports, so cancel it afterwards (below) and note its number.

- [ ] On the success screen press **Print**. The receipt prints once, with the correct token, items and total, and
      does **not** say REPRINT or CANCELLED. Nothing printed before you pressed Print.
- [ ] Go to **Bills**, open that bill, press **Reprint**. The receipt prints with **REPRINT** clearly marked.
- [ ] As the owner, cancel the same bill (**Cancel bill**, give a reason), open it again and press **Reprint**. The
      receipt shows **CANCELLED** (and REPRINT).
- [ ] Reprinting and cancelling did not use up a token: the next new bill continues the token sequence.

## 5. Repeat for the other paper width

- [ ] If you use both 58 mm and 80 mm rolls: change the driver paper size (section 2), change **Paper width** in
      Settings > Receipt, **Save**, and repeat sections 3 and 4.

## 6. Optional: print without the dialog (`--kiosk-printing`)

Only if you want Print to go straight to the printer. Follow [runbook.md](./runbook.md) section 6 to create the
shortcut, then:

- [ ] The receipt printer is the **Windows default printer**, with the right paper size and zero margins.
- [ ] Close all Chrome/Edge windows, then start the browser from the new shortcut.
- [ ] Press **Test Print** in Settings > Receipt: the paper prints at once, with no dialog, and passes the section 3
      checks.
- [ ] Charge a test bill, press **Print**: it prints at once. Press **Reprint** on Bills: it prints at once.
- [ ] Starting Chrome normally (without the shortcut) brings the dialog back, so there is a fallback.

## Results

| Date | Tester | Printer model | Paper width | Pass / Fail | Notes |
| ---- | ------ | ------------- | ----------- | ----------- | ----- |
|      |        |               | 58 mm       |             |       |
|      |        |               | 80 mm       |             |       |
|      |        |               | kiosk flag  |             |       |

Fix anything that fails (paper size, margins, Paper width setting, driver) and test again. If the layout still looks
wrong after that, note exactly what you see (photo of the paper, which line, which width) and report it.

## Known limitations

- Without the `--kiosk-printing` flag, the browser print dialog appears every time the cashier presses Print, Reprint
  or Test Print. Choose the receipt printer in it each time unless it is already the default.
- Test Print, Print and Reprint all honor the browser's own print settings (printer, margins, headers and footers,
  scale). Those can be remembered by the browser but are not controlled by the app, so check them if a receipt looks
  different from the preview.
- The receipt is formatted for the paper width chosen in Settings > Receipt, but the driver's paper size must match it.
  A mismatch causes clipped or tiny receipts.
- Where the paper is cut is decided by the printer and its driver, not by the app.
