import type { Metadata, Viewport } from 'next';
import { Inter, Oswald } from 'next/font/google';
import './globals.css';

/** Oswald is the closest widely available face to screen-printed layout type. */
const oswald = Oswald({
  variable: '--font-oswald',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Knotz Three Card Poker',
  description:
    'Three Card Poker as the Strip deals it: Ante and Play, Pair Plus, the Ante Bonus and the 6 Card Bonus, every paytable priced exactly, with a trainer that knows what each fold costs.',
  applicationName: 'Knotz Three Card Poker',
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
    title: 'Three Card',
    statusBarStyle: 'black-translucent',
  },
  other: {
    // Next emits only the standardised `mobile-web-app-capable`. iPhones a
    // couple of versions back read solely the Apple-prefixed spelling.
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0c10',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // The felt is a tap surface and the cards are animated. Pinch-zoom on either
  // is always an accident, never a request — the table scales itself instead.
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${oswald.variable} ${inter.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden">
        {/* Shown only on a phone held upright — see .rotate-hint in
            globals.css. It sits before {children} so that the sibling rule
            there can quiet the table behind it. */}
        <div className="rotate-hint" role="status" aria-live="polite">
          <svg className="rotate-hint__cards" width="84" height="76" viewBox="0 0 28 24" fill="none" aria-hidden="true">
            <rect x="2" y="4.5" width="10" height="14" rx="1.8" transform="rotate(-12 7 11.5)" stroke="var(--color-brass-400)" strokeWidth="1.3" />
            <rect x="9" y="4" width="10" height="14" rx="1.8" stroke="var(--color-brass-400)" strokeWidth="1.3" fill="rgba(226,188,78,0.06)" />
            <rect x="16" y="4.5" width="10" height="14" rx="1.8" transform="rotate(12 21 11.5)" stroke="var(--color-brass-400)" strokeWidth="1.3" fill="rgba(226,188,78,0.1)" />
          </svg>
          <p className="text-lg font-bold tracking-[0.18em] text-brass-400 uppercase" style={{ fontFamily: 'var(--font-display)' }}>
            Turn your phone sideways
          </p>
          <p className="max-w-xs text-sm leading-relaxed text-pit-300">
            Three seats across a table is a wide shape. Landscape gives it the room it needs.
          </p>
        </div>
        {children}
      </body>
    </html>
  );
}
