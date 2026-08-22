import type { Metadata } from "next";
import { getParticipantsWithFinance, getPayments } from "@/lib/data/admin";
import { PaymentsClient } from "@/components/admin/payments/payments-client";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const [payments, participants] = await Promise.all([
    getPayments(),
    getParticipantsWithFinance(),
  ]);
  return <PaymentsClient payments={payments} participants={participants} />;
}
