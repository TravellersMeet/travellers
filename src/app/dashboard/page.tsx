import { auth } from "@/lib/auth";
import Link from "next/link";
import prisma from "@/lib/prisma";
import FindMatchesButton from "@/components/FindMatchesButton";
import DashboardMatches from "@/components/DashboardMatches";
import type { Metadata } from "next";
import DashboardClient from "@/components/DashboardClient";
import TravelHeatmap from "@/components/spatial/TravelHeatmap";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Manage your travellersmeet profile, matches, and ticket verification.",
};

function calculateCompleteness(user: any) {
  let score = 0;
  if (user.name) score += 10;
  if (user.bio) score += 10;
  if (user.location) score += 10;
  if (user.image) score += 10;
  if (user.languages && user.languages.length > 0) score += 15;
  if (user.travelInterests && user.travelInterests.length > 0) score += 15;
  if (user.accommodationPrefs && user.accommodationPrefs.length > 0) score += 15;
  if (user.budgetRange) score += 5;
  if (user.age) score += 5;
  if (user.gender) score += 5;
  if (user.travelStyle) score += 5;
  return score;
}
export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">You need to sign in</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">Access your dashboard to upload a ticket and find matches.</p>
        <Link className="mt-6 inline-block rounded-lg bg-slate-900 px-4 py-2 font-medium text-white" href="/signin">Sign in</Link>
      </main>
    );
  }

  // Fetch tickets and user onboarded status in parallel
  const [tickets, user] = await Promise.all([
    prisma.ticket.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: "desc" } }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        onboarded: true,
        name: true,
        bio: true,
        location: true,
        image: true,
        languages: true,
        travelInterests: true,
        accommodationPrefs: true,
        budgetRange: true,
        age: true,
        gender: true,
        travelStyle: true,
      },
    }),
  ]);

  const onboarded = user?.onboarded ?? false;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <DashboardClient initialOnboarded={onboarded} />

      <div className="mb-10">
        <TravelHeatmap />
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your trips</h1>
        <Link className="rounded-lg border border-slate-300 dark:text-white dark:border-transparent dark:bg-slate-800 transition duration-150 px-4 py-2" href="/upload">Upload ticket</Link>
      </div>

      <div className="mt-8 grid gap-6">
        {tickets.length === 0 ? (
          <p className="text-slate-600 dark:text-slate-400">No trips yet. Upload a ticket to get verified and see matches.</p>
        ) : (
          tickets.map((t: any) => (
            <div key={t.id} className="rounded-2xl shadow-sm dark:border-slate-800 dark:bg-[#0F1129]/60 transition duration-150 border bg-white p-6">
              <div className="flex items-center justify-between pb-4">
                <div>
                  <p className="font-semibold text-lg">{t.destination}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">Departure: {new Date(t.departureDate).toDateString()}</p>
                </div>
<div className="flex items-center gap-3">
  <span
    className={`rounded-full border px-3 py-1 text-sm ${
      t.status === "VERIFIED"
        ? "border-green-500 text-green-600 dark:text-green-400"
        : "dark:border-slate-600"
    }`}
  >
    {t.status}
  </span>

  {t.status === "VERIFIED" && (
    <FindMatchesButton
      destination={t.destination}
      departureDate={new Date(t.departureDate)
        .toISOString()
        .split("T")[0]}
    />
  )}
</div>
              </div>
              {t.status === "VERIFIED" && (
                <DashboardMatches destination={t.destination} departureDate={t.departureDate.toISOString()} />
              )}
            </div>
          ))
        )}
      </div>
    </main>
  );
}
