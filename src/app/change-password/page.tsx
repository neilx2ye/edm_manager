import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth-helpers";
import ChangePasswordForm from "./form";

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <ChangePasswordForm />;
}
