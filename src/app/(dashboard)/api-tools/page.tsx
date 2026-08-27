import { Suspense } from "react";
import ApiToolsContent from "./content";
import { Spinner } from "@/components/ui";

export default function ApiToolsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ApiToolsContent />
    </Suspense>
  );
}
