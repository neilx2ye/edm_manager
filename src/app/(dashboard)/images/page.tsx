import { Suspense } from "react";
import ImagesContent from "./content";
import { Spinner } from "@/components/ui";

export default function ImagesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ImagesContent />
    </Suspense>
  );
}
