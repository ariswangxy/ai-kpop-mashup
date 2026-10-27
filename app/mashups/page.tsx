import type { Metadata } from "next";
import { MashupLibrary } from "@/components/MashupLibrary";

export const metadata: Metadata = { title: "My mashups · Mashup Studio" };

export default function MashupsPage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pt-6 pb-20 sm:px-6 sm:pt-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">My mashups</h1>
        <p className="text-sm text-muted">Everything you saved from the studio, newest first.</p>
      </div>
      <MashupLibrary />
    </main>
  );
}
