import type { Metadata, Viewport } from 'next';
import { Cinzel, Inter, Orbitron } from 'next/font/google';
import './globals.css';

/**
 * Cinzel is a Roman inscriptional face -- the closest widely available thing
 * to the carved, weighted lettering a cabinet's top glass uses. It is only
 * ever set large, which is where it works.
 */
const cinzel = Cinzel({
  variable: '--font-cinzel',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
});

/** Every number that ticks: meters, jackpots, the bet. */
const orbitron = Orbitron({
  variable: '--font-orbitron',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Dragon's Shrine",
  description:
    'A five-reel video slot with free spins, a hold-and-win link, four jackpots and a dragon that does not sit still.',
  applicationName: "Dragon's Shrine",
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
  // Added to the home screen on an iPhone, this is what makes it open without
  // Safari's chrome around it. iOS ignores the manifest for all of this and
  // reads these tags instead, so both have to say the same thing.
  appleWebApp: {
    capable: true,
    title: "Dragon's Shrine",
    statusBarStyle: 'black-translucent',
  },
  other: {
    // Next emits only the standardised `mobile-web-app-capable`. Current iOS
    // honours it, but iPhones a couple of versions back read solely the
    // Apple-prefixed spelling, and without it the home-screen icon opens in a
    // normal Safari tab with the address bar still there.
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: '#05060a',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // The reels are a tap surface and the effects are a canvas. Pinch-zoom on
  // either is always an accident; the cabinet scales itself to the viewport.
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${cinzel.variable} ${inter.variable} ${orbitron.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
