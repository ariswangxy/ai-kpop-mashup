import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono, Unbounded } from "next/font/google";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin"], weight: ["500", "700", "800"] });
const instrument = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mashup Studio",
  description: "Put the vocals from one K-pop track over the instrumental of another and get a 30-second mashup.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${unbounded.variable} ${instrument.variable} ${jetbrains.variable} antialiased`}>
        <div className="stage-glow min-h-dvh">
          <SiteHeader />
          {children}
        </div>
      </body>
    </html>
  );
}
