import { ReactNode } from "react";
import { redirect } from "next/navigation";

import Sidebar from "@/components/Sidebar";
import { auth } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();

  if (session == null || session.user == null) {
    redirect("/signin");
    return null;
  }

  return (
    <div className="flex bg-[#FDFCF8] dark:bg-[#0A0B1E] min-h-[calc(100vh-64px)]">
      <Sidebar />
      <main className="flex-1 p-8 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
