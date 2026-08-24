import type { Metadata } from "next";
import { getParticipantsWithFinance } from "@/lib/data/admin";
import { EmailsClient } from "@/components/admin/emails/emails-client";

export const metadata: Metadata = { title: "Emails" };
export const dynamic = "force-dynamic";

export default async function EmailsPage() {
  const participants = await getParticipantsWithFinance();
  return <EmailsClient participants={participants} />;
}
