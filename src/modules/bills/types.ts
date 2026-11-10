export interface BillItemRow {
  productName: string;
  categoryName: string;
  unitPricePaise: number;
  quantity: number;
  lineTotalPaise: number;
}

export interface ShopSnapshot {
  name: string;
  address: string;
  phone: string;
  gstin: string | null;
}

export interface GstSnapshot {
  enabled: boolean;
  rateBp: number;
  inclusive: boolean;
  title: string;
}

export interface BillPayment {
  method: "CASH" | "UPI";
  amountPaise: number;
  cashTenderedPaise: number | null;
  changePaise: number | null;
  upiReference: string | null;
  status: "RECORDED" | "VOIDED";
}

export interface BillDetail {
  id: string;
  billNumber: number;
  billNumberDisplay: string;
  tokenNumber: number;
  businessDate: string;
  status: "COMPLETED" | "CANCELLED";
  createdAt: Date;
  items: BillItemRow[];
  subtotalPaise: number;
  discountType: "FLAT" | "PERCENT" | null;
  discountValue: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  taxPaise: number;
  taxIncluded: boolean;
  roundOffPaise: number;
  totalPaise: number;
  payment: BillPayment;
  customerName: string | null;
  customerPhone: string | null;
  printCount: number;
  cancelledAt: Date | null;
  cancelReason: string | null;
  shopSnapshot: ShopSnapshot;
  gstSnapshot: GstSnapshot;
}
