import type { Metadata, Viewport } from 'next';
import { Inter, Orbitron, JetBrains_Mono } from 'next/font/google';
import './globals.css';

/*
 * Three faces, each doing one job, and all three self-hosted by `next/font` at
 * build time rather than fetched from Google at run time. That is not a
 * preference: the floor serves this app under a content-security policy with no
 * remote origins at all, so a stylesheet from `fonts.googleapis.com` would be
 * blocked and every heading would silently fall back.
 */

/** Headings, buttons, anything that should look machined. */
const orbitron = Orbitron({
  variable: '--font-orbitron',
  subsets: ['latin'],
  weight: ['500', '700', '800', '900'],
  display: 'swap',
});

/** Everything a person actually reads. */
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

/**
 * Money.
 *
 * A monospace with real tabular figures, because the wallet counts up digit by
 * digit and a proportional face makes it shuffle sideways while it climbs.
 */
const mono = JetBrains_Mono({
  variable: '--font-mono-stack',
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Knotz Casino',
  description:
    'One bankroll, four floors. Craps with real dice, blackjack with six side bets, three card poker priced to the decimal, and a dragon that takes over the screen.',
  applicationName: 'Knotz Casino',
  // The shell is installable, and on a phone that is the difference between a
  // website and a casino: full screen, its own icon, no browser chrome eating
  // the rail.
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Knotz Casino' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#03050b',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  // A game frame is the whole viewport and manages its own scale; letting a
  // pinch zoom the *shell* around it leaves a game half off the screen with no
  // way back.
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${orbitron.variable} ${inter.variable} ${mono.variable} h-full antialiased`}
    >
      {/*
       * `concourse` paints the room — see globals.css. It is on the body rather
       * than on a wrapper so that the fixed layers it draws are relative to the
       * viewport and cannot be clipped by a page's own overflow.
       */}
      <body className="concourse h-full overflow-x-hidden bg-void-950">{children}</body>
    </html>
  );
}
