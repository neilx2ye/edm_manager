import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { getSessionUser } from "@/lib/auth-helpers";
import Sidebar from "@/components/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");

  return (
    <div className="flex h-screen overflow-hidden">
      <Suspense>
        <Sidebar user={{ name: user.name, email: user.email }} />
      </Suspense>
      <main
        className="h-full min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ maxHeight: "100vh" }}
      >
        {children}
      </main>
    </div>
  );
}
