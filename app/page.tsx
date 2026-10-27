import { Studio } from "@/components/studio/Studio";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 pt-6 pb-20 sm:px-6 sm:pt-10">
      <div className="flex max-w-3xl flex-col gap-4">
        <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">K-pop mashups</p>
        <h1 className="font-display text-3xl leading-[1.1] font-extrabold tracking-tight sm:text-5xl">
          <span className="text-a">Vocals</span> from one hit.
          <br />
          The <span className="text-b">beat</span> from another.
        </h1>
        <p className="max-w-xl text-base text-muted">
          Upload two songs. We pull the vocals from Song A, lay them over the instrumental from Song B, and hand back
          a 30-second clip or a full-song mashup you can play, download and save.
        </p>
      </div>
      <Studio />
      <p className="text-xs text-muted">
        Only upload tracks you have the rights to use. Vocals and instrumentals are separated by Demucs, an
        open-source AI model running on this computer. Nothing is sent to an outside service.
      </p>
    </main>
  );
}
