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
  title: 'Knotz Craps',
  description:
    'A full craps table with real dice physics, true casino odds, and two seats at the rail.',
  applicationName: 'Knotz Craps',
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
    title: 'Craps',
    // The table is dark to its edges; a translucent bar lets the felt run
    // under the clock rather than sitting below a white strip.
    statusBarStyle: 'black-translucent',
  },
  other: {
    // Next emits only the standardised `mobile-web-app-capable`. Current iOS
    // honours it, but iPhones a couple of versions back read solely the
    // Apple-prefixed spelling, and without it they open the home-screen icon
    // in a normal Safari tab with the address bar still there.
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: '#0b0d10',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // The felt is a drag surface and the dice are a canvas. Pinch-zoom on either
  // is always an accident, never a request, so it is off — the table scales
  // itself to the viewport instead.
  maximumScale: 1,
  userScalable: false,
  // Lets the layout paint into the notch and home-indicator area; globals.css
  // then pads the content back out with the safe-area insets.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${oswald.variable} ${inter.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden">
        {/* Shown only on a phone held upright -- see .rotate-hint in
            globals.css. It sits before {children} so that the sibling rule
            there can quiet the table behind it. */}
        <div className="rotate-hint" role="status" aria-live="polite">
          <svg
            className="rotate-hint__dice"
            width="72"
            height="72"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="3"
              width="18"
              height="18"
              rx="4"
              stroke="var(--color-brass-400)"
              strokeWidth="1.5"
            />
            <circle cx="8.5" cy="8.5" r="1.6" fill="var(--color-brass-400)" />
            <circle cx="12" cy="12" r="1.6" fill="var(--color-brass-400)" />
            <circle cx="15.5" cy="15.5" r="1.6" fill="var(--color-brass-400)" />
          </svg>
          <p
            className="text-lg font-bold tracking-[0.18em] text-brass-400 uppercase"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Turn your phone sideways
          </p>
          <p className="max-w-xs text-sm leading-relaxed text-pit-300">
            A craps layout is a wide table. Landscape gives it the room it needs.
          </p>
        </div>
        {children}
      </body>
    </html>
  );
}
