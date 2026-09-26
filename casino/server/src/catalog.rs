//! The catalog: what is on the floor.
//!
//! A game is a row here plus a directory of static files under
//! `KNOTZ_GAMES_DIR/<slug>` that speaks the casino protocol. Nothing else.
//! There is no per-game code in this server, no per-game endpoint and no
//! per-game table — adding a fifth game is a `Game` literal and a build step,
//! which is the whole point of having a floor rather than four sites.
//!
//! The figures in `edge_label` are not marketing copy. Each one is what that
//! game's own simulation suite measures, and each game's README shows the
//! working. A floor that advertises a return it cannot reproduce is a floor
//! nobody should trust with a bankroll, even a play-money one.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub slug: &'static str,
    pub title: &'static str,
    pub tagline: &'static str,
    pub kind: &'static str,
    /// Where the frame points, relative to the floor's own origin.
    pub path: &'static str,
    pub accent: &'static str,
    pub accent_alt: &'static str,
    pub min_bet: i64,
    pub max_bet: i64,
    pub default_buy_in: i64,
    pub denominations: &'static [i64],
    pub edge_label: &'static str,
    pub highlights: &'static [&'static str],
    pub live: bool,
}

/// Cents, spelled so the numbers below read as money.
const fn dollars(n: i64) -> i64 {
    n * 100
}

pub static CATALOG: &[Game] = &[
    Game {
        slug: "craps",
        title: "Knotz Craps",
        tagline: "Real dice, real physics, true odds behind the line",
        kind: "table",
        path: "/games/craps/",
        accent: "#f0b429",
        accent_alt: "#10b981",
        min_bet: dollars(5),
        max_bet: dollars(5_000),
        default_buy_in: dollars(1_000),
        denominations: &[
            dollars(1),
            dollars(5),
            dollars(25),
            dollars(100),
            dollars(500),
            dollars(1_000),
        ],
        edge_label: "1.41% on the pass line · 0% on the odds",
        highlights: &[
            "Rigid-body dice that land on the number the RNG called",
            "The full layout: line, come, place, buy, lay, hardways, props",
            "Up to 100× odds, and a dealer who takes inside, outside and across",
            "A strategy workshop that runs a rule set against a million rolls",
        ],
        live: true,
    },
    Game {
        slug: "blackjack",
        title: "Knotz Blackjack 21",
        tagline: "Three seats, six side bets, and a shoe that counts itself",
        kind: "table",
        path: "/games/blackjack/",
        accent: "#e8c05a",
        accent_alt: "#0d6153",
        min_bet: dollars(5),
        max_bet: dollars(2_500),
        default_buy_in: dollars(1_000),
        denominations: &[
            dollars(1),
            dollars(5),
            dollars(25),
            dollars(100),
            dollars(500),
            dollars(1_000),
        ],
        edge_label: "0.41% on Vegas Strip rules, played correctly",
        highlights: &[
            "Every rule set: S17/H17, DAS, surrender, peek, 3:2 or 6:5",
            "Pairs, 21+3, Lucky Ladies, Royal Match, Super Sevens, Bust It",
            "A trainer that grades every decision against basic strategy",
            "A true-count meter that follows the shoe as it is dealt",
        ],
        live: true,
    },
    Game {
        slug: "three-card-poker",
        title: "Knotz Three Card Poker",
        tagline: "Ante and Play, Pair Plus, and a fold that knows what it cost",
        kind: "table",
        path: "/games/three-card-poker/",
        accent: "#cf6ac9",
        accent_alt: "#63aee0",
        min_bet: dollars(5),
        max_bet: dollars(1_000),
        default_buy_in: dollars(750),
        denominations: &[
            dollars(1),
            dollars(5),
            dollars(25),
            dollars(100),
            dollars(500),
        ],
        edge_label: "3.37% per Ante at 5-4-1 · 2.01% element of risk",
        highlights: &[
            "Ante and Play with the Ante Bonus, priced exactly",
            "Pair Plus and the 6 Card Bonus, every paytable enumerated",
            "Q-6-4 or better, and the trainer that shows what a fold gives up",
            "Dealer qualification on Queen high, as it is dealt everywhere",
        ],
        live: true,
    },
    Game {
        slug: "dragons-shrine",
        title: "Dragon's Shrine",
        tagline: "Five reels, four jackpots, and a dragon that takes over the screen",
        kind: "slots",
        path: "/games/dragons-shrine/",
        accent: "#f97316",
        accent_alt: "#a855f7",
        min_bet: 20,
        max_bet: dollars(100),
        default_buy_in: dollars(2_000),
        denominations: &[20, 100, dollars(1), dollars(5), dollars(25), dollars(100)],
        edge_label: "96.56% RTP, measured over a hundred million spins",
        highlights: &[
            "5×4 reels, 50 lines, and a hand-drawn shrine behind them",
            "Free spins with a rising multiplier and a full-reel dragon",
            "Hold and win: lock the orbs, win one of four jackpots",
            "Buy the feature, or gamble the win on the colour of a card",
        ],
        live: true,
    },
];

pub fn find(slug: &str) -> Option<&'static Game> {
    CATALOG.iter().find(|g| g.slug == slug)
}
