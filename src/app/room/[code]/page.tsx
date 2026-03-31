import { RoomView } from "@/components/room/RoomView";
import { Suspense } from "react";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalized = code.trim().toUpperCase();

  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center py-24 text-zinc-500">
          Chargement…
        </div>
      }
    >
      <RoomView code={normalized} />
    </Suspense>
  );
}
