# Mashup Studio

Upload two songs, take the vocals from Song A and the instrumental from Song B, and get a 30-second mashup.

Built with Next.js (App Router), TypeScript, Tailwind CSS v4 and Supabase (optional).

## Run it

```bash
npm install
npm run dev      # http://localhost:3001
npm test         # unit tests for the audio code
```

## AI separation (clean vocals and instrumental)

Stems come from [Demucs](https://github.com/facebookresearch/demucs) (`htdemucs_ft`, MIT), running locally in `separator/server.py`. Only the 30-second sections are sent to it.

```bash
npm run separator:setup   # once: Python 3.11 venv + PyTorch + Demucs + madmom (~2 GB)
npm run separator         # keep running next to `npm run dev`; first start downloads the model
```

- Only the vocals specialist of `htdemucs_ft` runs; the instrumental is the mix minus the vocals. About 15 s per stem on an M2 CPU.
- Apple GPUs (MPS) can't run Demucs (a convolution exceeds an MPS limit in PyTorch 2.5–2.8), so Macs use the CPU. `SEPARATOR_DEVICE=cuda` works on NVIDIA machines.
- The Next.js route `app/api/separate/route.ts` proxies to it (`SEPARATOR_URL`, default `http://127.0.0.1:8765`).
- If the separator isn't running, the studio says so and falls back to the in-browser preview engine below.
- The AI packages live in `separator/requirements-ai.txt`. `separator/requirements.txt` is what Vercel installs and is deliberately empty (see Deploying).
- **Full-song mashups** send both whole songs in 60 s chunks (crossfaded over 4 s overlaps) with live progress and a Cancel button. Expect about a minute of processing per minute of music on an M2.

## How processing works

Every mashup runs the steps in `lib/processing/pipeline.ts`. `demucsProcessor` gets stems from the separator; `mockProcessor` approximates them in the browser with Web Audio DSP:

- **Vocals (Song A):** the center (mid) channel, band-limited to the voice range.
- **Instrumental (Song B):** the side channel (L−R cancels center-panned vocals) plus low bass from the mid channel.
- **Length:** a 30-second clip of the picked sections, or the full song: all of Song A's vocals over all of Song B's instrumental (output is Song B's length), placed so the picked sections land together, on the beat.
- **Chorus detection:** on upload, each song's 30 s window is placed on its chorus (`lib/audio/chorus.ts`): the section that repeats most across the song and is loud, with the start moved to the section boundary and onto a beat. "Jump to chorus" puts it back after you drag it.
- **Beat-1 alignment (always on):** on upload, a quick in-browser estimate (`lib/audio/beats.ts`: kick hits and chord changes mark beat 1) shows the song right away; when the AI service runs, madmom's trained downbeat tracker (`POST /beats`, ~20 s per song) replaces the bar positions and Generate waits for it. Tempo for stretching stays the app's own drift-checked BPM, since madmom's beats wobble by tens of ms. Start points always sit on beat 1 of a bar, including after dragging, and the vocals' beat 1 lands exactly on the instrumental's beat 1.
- **Tempo match (on by default):** each song's BPM is detected on upload (`lib/audio/tempo.ts`) and can be edited. The vocals are time-stretched to Song B's tempo with pitch kept (WSOLA, `lib/audio/stretch.ts`), then shifted so their beats land on Song B's. Half and double time count as a match. Pairs more than 25% apart skip tempo match.
- **Key shift (Auto by default):** each song's key is detected on upload (`lib/audio/key.ts`, Krumhansl–Schmuckler) and can be corrected. Auto picks the smallest shift (at most 6 semitones) that puts Song A's vocals in Song B's key; relative major/minor counts as the same key, since they share every note. The −/+ buttons set a manual shift of up to ±6. Pitch is shifted by resampling plus time-stretch, so timing is unchanged (`stretchAndShift` in `lib/audio/stretch.ts`).
- Mixed through a limiter with 1.5 s fades, then encoded as WAV.

The preview engine leaves audible bleed; use the AI separator for clean stems.

## Supabase (optional)

Without Supabase env vars, saved mashups are kept in IndexedDB in the browser. To store them in Supabase:

1. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Apply the files in `supabase/migrations/` in order (`supabase db push`, or paste it into the SQL editor). It creates the `mashups` table and the private `tracks` and `mashups` storage buckets.

Ownership uses an anonymous per-browser id sent as an `x-owner-id` header. That is fine for development, but anyone can send any header, so add Supabase Auth and switch the policies to `auth.uid()` before making this public.

## Deploying (Vercel)

`vercel.json` deploys two [Vercel services](https://vercel.com/docs/services) as one project:

- `app`, the Next.js site, is public on every path.
- `separator` (`separator/server.py`) is internal. Only `app` reaches it, through a binding that injects `SEPARATOR_URL`; don't set that variable yourself.

For now the deployed separator has no AI models. `separator/requirements.txt` is empty, so `/health` reports `installed: false` and the site uses the preview engine. The full separator doesn't fit Vercel Functions yet: requests and responses are capped at 4.5 MB (a 64 s chunk is about 11 MB), and PyTorch + madmom need a CPU-only, Python 3.12 build. Run `vercel dev` to try both services together locally.
