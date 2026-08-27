"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { Spinner } from "@/components/ui";

/** 首页：重定向到第一个可访问项目的模板列表。 */
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const me = await api.me();
        if (me.mustChangePassword) {
          router.replace("/change-password");
          return;
        }
        const projects = await api.projects.list();
        if (projects.length > 0) {
          router.replace(`/templates?projectId=${projects[0].id}`);
        } else {
          router.replace("/templates");
        }
      } catch {
        router.replace("/login");
      }
    })();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner />
    </div>
  );
}
