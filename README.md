# IPL Auction 3D

An unofficial, fan-made browser auction simulator built with Vite, JavaScript, and Three.js. Run `npm install` once, then `npm run dev`.

## Current implementation

- Ten selectable IPL franchises and nine rival bidding agents.
- A Three.js auditorium with LED stage trim, a geometric auctioneer, ten franchise-color tables with lightweight bidding representatives, instanced audience silhouettes, orbit/zoom, and smooth camera presets including the highest bidder.
- A custom-simulation set-ordered pool, deterministic seeded within-set shuffle, bid/pass/skip controls, going-once/going-twice/final-call stages, legal purse/squad/overseas checks, exact-once result finalization, squad and retention dashboards, searchable player catalogue, bid/event history, franchise comparison, pause/resume, and validated local save/resume. Queue position and set metadata survive save/load; no official auction order is claimed.
- Nine franchise-specific AI strategies with deterministic primary/secondary/backup targets. Franchise valuations combine separate batting/bowling simulation ratings, verified evidence, role gaps, alternatives, competing role demand, confidence, purse reserves, squad slots, overseas limits, and legal bid increments. Every result includes a value range, recommended limit, confidence, positives, and risks. Hard difficulty changes strategy, not team budgets.
- A live role-relevant player profile during introductions using the latest completed IPL season before the selected 2025/2026 auction season, separately labelled simulation ratings, missing-data disclosures, source links, and the user's franchise-specific estimated value. The catalogue reports verified-data coverage for the supplied identities.
- A searchable catalogue with role, category, verified franchise, nationality group, status, capped-status, base-price, and rating filters; verified-stat sorting; and player detail panels that distinguish historical facts from simulation data.
- A pre-auction target planner with primary/secondary/backup priorities, role priorities, preferred spend limits, projected budget, reordering, retained-player exclusion, and per-franchise local persistence. The plan is also included in validated auction saves.
- Event-driven auctioneer commentary with an opening address before the first category, full set/lot/player introductions, natural lakh/crore speech, coalesced bid updates, final-call and optional RTM response windows, live subtitles, voice/mute/volume/rate/test controls, replay, and lot-scoped stale-announcement protection. Bidding opens after the player introduction completes; when voice is unavailable, subtitles remain available and the auction continues.
- Relaxed (default), Standard, and Fast pacing profiles with independent AI-response, lot-settlement, and result-transition timers. Sold and unsold lots advance automatically after the result announcement, with no dependence on a manual next-player action.
- Pre-auction retention desk for all ten franchises, using supplied lists as unverified simulation associations. Nine AI franchises receive deterministic recommendations with reasons based on role need, replacement scarcity, versatility, estimated ability, confidence, and configured slot cost; all decisions can be manually overridden. Mega/Mini defaults are 3/5 players. Slot costs are custom simulation rules. Retentions, releases, recommendation reasons, owners, costs, and purses persist; retained players are excluded from the queue.
- Optional RTM simulation is off by default and can only be offered when a released player's prior franchise is explicitly verified. The right matches the actual live amount, uses the same purse/roster checks, and is saved with its franchise quota.
- Player identities across the supplied franchise lists are deduplicated into canonical records. Each record separates IPL career through 2025-06-03, IPL 2025, other T20 career, domestic records, and simulation ratings. Unavailable statistical values remain `null`, are listed in `missingFields`, and render as N/A. Estimated ratings are deterministic, role-informed game priors with low/very-low confidence, not official statistics. Seed records without a configured numeric simulation base price are excluded from the auction pool; an unverified seed association alone does not establish season membership or eligibility.
- A category-ordered auction pool with sequential lot numbers, category transition announcements, and lot-number preservation across local save/resume.
- A live rival panel showing all nine AI purses, squad and overseas counts, role needs, eligibility, and the current leading bidder. Add `?debugAI=1` to the URL for developer-only decision explanations.
- Custom starter rules: ₹120 crore purse, 18–25 players per squad, up to 8 overseas players. These are game defaults, not claims about official IPL rules.

## Data limitations

The catalogue includes season-labelled 2026 retained-player records from the official IPL retention announcement and the ten supplied, unverified franchise seed lists. User decisions in the custom retention desk are simulation actions, not verification of official rosters. Released status there means released from that simulation's seed association, not a claim about an official auction release. Existing catalogue records do **not** assert season-specific auction eligibility, age, historical franchise, capped status, or performance statistics unless explicitly marked. Role and India/overseas groupings are provisional game classifications. Player ratings, category assignment, prices, and AI valuations are simulated game data.

No real auction catalogue order was verified for the selected seasons. The displayed sets are a clearly labelled custom simulation grouping and use saved-seed shuffling only within each set. RTM is unavailable for unverified seed-list ownership.

### Statistics coverage

Coverage is calculated from 257 unique canonical players in the ten supplied franchise lists. The full catalogue has 351 records, including 94 additional retention-only identities. As currently verified, 6 supplied-list players have partial IPL 2025 statistics: 3 batters and 3 bowlers; 0 all-rounders and 0 wicketkeepers have verified statistics. The six supported fields are runs for Sai Sudharsan (759), Suryakumar Yadav (717), and Virat Kohli (657), and wickets for Prasidh Krishna (25), Noor Ahmad (24), and Josh Hazlewood (22). Each value links to the [IPL.com IPL 2025 statistics page](https://www.ipl.com/series/indian-premier-league-2025-129413/stats); these are leaderboard figures, not complete player scorecards.

Verified profile coverage: 6 partial, 0 complete. Verified IPL 2025: 6; IPL career through 2025-06-03: 0; other T20 career: 0; domestic competitions: 0. Of the 257 supplied-list identities, 132 have simulation estimates only and 119 have insufficient role/performance evidence. Missing figures are null and are not replaced with zero. The provided IPL records page reflects data beyond the selected 2025 cutoff, so its current career totals are intentionally not used. The provided Cricbuzz page redirected to an advertising endpoint during research and could not be used to verify additional records. These counts are also shown in the player catalogue and should change only when sourced field-level records are added.

Verified figures are stored locally as field-level entries in `src/data/verifiedStats.js`; the game performs no live scraping. Add exact canonical-name records with a source URL, period cutoff, and verification date, then run `npm run validate:data` and `npm test` before using them.

No portraits or external player images are bundled. No licensed rigged character asset is included; the 3D stage figure is a geometric fallback with subtle idle and speaking animations, but no facial/lip-sync rig. Accelerated/recall rounds, tournament simulation, and advanced rigged-character animations are not implemented.

## Validation

- `npm test` runs the Node test suite.
- `npm run build` creates the production bundle in `dist/`.
