import "@/styles/globals.css";
import { Playfair_Display, Inter, JetBrains_Mono } from "next/font/google";

const display = Playfair_Display({
  subsets: ["latin"],
  weight: ["700", "900"],
  variable: "--font-display",
});
const body = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export default function App({ Component, pageProps }) {
  return (
    <main className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <Component {...pageProps} />
    </main>
  );
}
