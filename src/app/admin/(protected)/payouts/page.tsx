import type { Metadata } from "next";
import { getAdminGames, getPayouts } from "@/lib/data/admin";
import { PayoutsClient } from "@/components/admin/payouts/payouts-client";

export const metadata: Metadata = { title: "Payouts" };
export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const [payouts, games] = await Promise.all([getPayouts(), getAdminGames()]);
  return <PayoutsClient payouts={payouts} games={games} />;
}
