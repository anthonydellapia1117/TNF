import type { Metadata } from "next";
import { getParticipantsWithFinance } from "@/lib/data/admin";
import { ParticipantsClient } from "@/components/admin/participants/participants-client";

export const metadata: Metadata = { title: "Participants" };
export const dynamic = "force-dynamic";

export default async function ParticipantsPage() {
  const participants = await getParticipantsWithFinance();
  return <ParticipantsClient participants={participants} />;
}
