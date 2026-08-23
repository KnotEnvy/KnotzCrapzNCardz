**1. Tech Stack & Architecture**

* **Framework:** Next.js (App Router, React, TypeScript)
* **State Management:** Zustand with `immer` middleware (essential for handling nested bet states, payouts, and bankrolls mutably)
* **UI/Styling:** Tailwind CSS + Shadcn UI + Framer Motion (for smooth chip stacking and felt animations)
* **Dice Engine:** Three.js / React Three Fiber for 3D physics dice rolls (fallback: Framer Motion 2D animated dice)

**2. Game Engine & State Machine**

* **Table States:** `COME_OUT` and `POINT_SET` (tracks active point 4, 5, 6, 8, 9, 10).
* **Bet Registry:** Supports Line Bets (Pass/Don't Pass, Come/Don't Come with dynamic sub-points), Place/Buy/Lay (4–10), Field, Hardways, and Proposition single-roll bets.
* **Bet Modifiers:** Toggle bet status (`Working` vs. `Off` during Come-Out rolls) and dynamic odds enforcement (e.g., 3X-4X-5X max odds calculation).
* **Payout Calculator Engine:** Standalone, deterministic math module rendering true casino odds (e.g., Place 6/8 pays 7:6, Place 5/9 pays 7:5).

| Action | Supported Advanced Mechanics |
| --- | --- |
| **Line Odds** | Auto-max odds button behind Pass/Come bets based on table multiplier. |
| **Bet Controls** | "Press All", "Power Press", "Same Action", "Off/On All", "Take Down". |
| **Roll Velocity** | Fast-roll toggle to bypass dice animations for rapid-fire strategy testing. |

**3. UX/UI Felt Layout Specs**

* **Interactive Felt:** SVG-mapped betting areas with responsive hitboxes for high-precision chip placement.
* **Chip Rack:** Customizable chip stack denominators ($1, $5, $25, $100, $500) with quick drag-or-click betting UI.
* **Pro HUD:** Roll history bell-curve distribution graph (theoretical 7 vs. actual roll counts), session variance graphs, and net table yield.

