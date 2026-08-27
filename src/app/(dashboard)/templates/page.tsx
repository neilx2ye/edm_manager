import { Suspense } from "react";
import TemplatesContent from "./content";
import { Spinner } from "@/components/ui";

export default function TemplatesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <TemplatesContent />
    </Suspense>
  );
}
