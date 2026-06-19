"use client";

import { useParams } from "next/navigation";
import PublicCardView from "@/components/business-card/PublicCardView";

export default function PublicCardPage() {
  const params = useParams<{ slug: string }>();
  return <PublicCardView slug={decodeURIComponent(params.slug || "")} />;
}

