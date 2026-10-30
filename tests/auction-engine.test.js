import test from "node:test";
import assert from "node:assert/strict";
import { AuctionEngine, GAME_STATES, createAuctionOrder, createSeededRandom, isEligibleForAuction, nextBidAmount, shuffle } from "../src/game/AuctionEngine.js";
import { FRANCHISE_SEED_LISTS, IPL_2026_RETAINED_PLAYERS, PLAYERS, resolvePlayerAlias, validatePlayers } from "../src/data/players.js";
import { FRANCHISES, CUSTOM_RULES, createFranchiseState } from "../src/data/franchises.js";
import { aiBidDecision, evaluatePlayerValue, legalMaximumBid, reserveForMandatorySlots } from "../src/game/PlayerValuation.js";
import { AuctionClock, finalCallStageDurations, normalizeFinalCallDuration } from "../src/game/AuctionClock.js";
import { buildTeamsAfterRetention, createSampleHistory, isRetentionCandidateFor, recommendFranchiseRetentions, retentionCost, retentionLimit } from "../src/game/RetentionRules.js";
import { filterCatalogue, verifiedFranchiseForCatalogue, verifiedStatForCatalogue } from "../src/game/PlayerCatalogue.js";
import { plannedSpend, validateUserTargetPlan } from "../src/game/UserTargetPlan.js";
import { commentaryFor, AuctioneerDirector } from "../src/auctioneer/AuctioneerDirector.js";
import { buildPlayerDataCoverage, hasVerifiedStatistics, ratingsForAuctionSeason, statisticsForAuctionSeason, validateVerifiedStatRecords } from "../src/data/PlayerProfiles.js";
import { VERIFIED_STAT_RECORDS } from "../src/data/verifiedStats.js";

const engineFor = (options = {}) => new AuctionEngine({
  players: PLAYERS,
  userTeam: "CSK",
  randomized: false,
  seed: 42,
  ...options
});

function startBidding(engine) {
  const player = engine.startLot();
  if (engine.state === GAME_STATES.READY) engine.startLot();
  assert.equal(engine.state, GAME_STATES.INTRODUCING);
  assert.equal(engine.openBidding(`${engine.index}:${player.id}`), true);
  return player;
}

test("player catalogue has unique IDs, names, valid roles, prices, and source labels", () => {
  assert.ok(PLAYERS.length >= 180, `expected at least 180 players, got ${PLAYERS.length}`);
  assert.deepEqual(validatePlayers(), []);
  assert.ok(PLAYERS.every((player) => player.capped === null && player.auctionEligibility === "not asserted"));
});

test("all franchise seed names resolve to canonical identities without inventing roster facts", () => {
  const ids = new Set(PLAYERS.map((player) => player.id));
  const franchiseCodes = new Set(FRANCHISES.map((team) => team.code));
  assert.equal(ids.size, PLAYERS.length);
  for (const [franchiseCode, playerNames] of Object.entries(FRANCHISE_SEED_LISTS)) {
    assert.ok(franchiseCodes.has(franchiseCode));
    for (const name of playerNames.split(",")) {
      const player = resolvePlayerAlias(name);
      assert.ok(player, `missing seed player ${name}`);
      assert.ok(player.seedFranchiseCodes.includes(franchiseCode), `${name} missing ${franchiseCode} seed association`);
    }
  }
  assert.equal(resolvePlayerAlias("Mohammad Siraj").id, resolvePlayerAlias("Mohammed Siraj").id);
  assert.equal(resolvePlayerAlias("Allah Mohammad Ghazanfar").id, resolvePlayerAlias("Allah Ghazanfar").id);
  assert.equal(resolvePlayerAlias("Rasikh Dar Salam").id, resolvePlayerAlias("Rasikh Dar").id);
  assert.equal(resolvePlayerAlias("Lhuan-Dre Pretorious").id, resolvePlayerAlias("Lhuan-dre Pretorius").id);
  assert.equal(resolvePlayerAlias("Mohd. Arshad Khan").id, resolvePlayerAlias("Arshad Khan").id);
  const unknownPrice = PLAYERS.find((player) => player.id.startsWith("seed-"));
  assert.equal(unknownPrice.basePrice, null);
  assert.equal(unknownPrice.simulationRatings.overall.status, "estimated");
  assert.equal(unknownPrice.simulationRatings.overall.confidence, "very low");
  assert.equal(unknownPrice.rating, unknownPrice.simulationRatings.overall.value);
  assert.equal(unknownPrice.isOverseas, null);
  assert.equal(unknownPrice.auctionEligibility, "not asserted");
});

test("every canonical player has period-separated statistics, estimates, and auditable missing fields", () => {
  const coverage = buildPlayerDataCoverage(PLAYERS);
  assert.equal(coverage.totalUniquePlayers, 257);
  assert.equal(coverage.totalCatalogueRecords, PLAYERS.length);
  assert.equal(coverage.verifiedProfiles, 6);
  assert.equal(coverage.partialProfiles, 6);
  assert.equal(coverage.completeProfiles, 0);
  assert.deepEqual(coverage.verifiedByRole, { batters: 3, bowlers: 3, allrounders: 0, wicketkeepers: 0 });
  assert.equal(coverage.verifiedIPL2025, 6);
  assert.equal(coverage.verifiedIPLCareer, 0);
  assert.equal(coverage.verifiedOtherT20, 0);
  assert.equal(coverage.verifiedDomestic, 0);
  assert.equal(coverage.simulationEstimatesOnly, 132);
  assert.equal(coverage.insufficientData, 119);
  for (const player of PLAYERS) {
    assert.ok(player.id);
    assert.deepEqual(Object.keys(player.statistics), ["ipl2024", "iplCareer", "ipl2025", "otherT20Career", "domestic"]);
    assert.ok(player.simulationRatings.overall.value >= 25 && player.simulationRatings.overall.value <= 82);
    assert.equal(player.simulationRatings.overall.status,
      player.statsVerified ? "verified-data-derived" : "estimated");
    assert.ok(player.missingFields.length > 0);
    for (const period of Object.values(player.statistics)) {
      assert.equal(hasVerifiedStatistics(period), Object.keys(period.fieldSources).length > 0);
      for (const [field, source] of Object.entries(period.fieldSources)) {
        const [section, metric] = field.split(".");
        assert.notEqual(period[section][metric], null);
        assert.ok(source.url && source.period);
      }
    }
  }
  const verifiedRunLeader = resolvePlayerAlias("Sai Sudharsan");
  assert.equal(verifiedRunLeader.statistics.ipl2025.batting.runs, 759);
  assert.equal(verifiedRunLeader.statistics.ipl2025.bowling.wickets, null);
  assert.equal(verifiedRunLeader.statistics.iplCareer.batting.runs, null);
  assert.equal(verifiedRunLeader.statistics.ipl2024.batting.runs, null);
  assert.equal(statisticsForAuctionSeason(verifiedRunLeader, 2025).period, "IPL 2024: not researched");
  assert.equal(statisticsForAuctionSeason(verifiedRunLeader, 2026).batting.runs, 759);
  assert.equal(statisticsForAuctionSeason(verifiedRunLeader, 2027), null);
  assert.equal(ratingsForAuctionSeason(verifiedRunLeader, 2025).batting.status, "estimated");
  assert.equal(ratingsForAuctionSeason(verifiedRunLeader, 2026).batting.status, "verified-data-derived");
  assert.ok(!ratingsForAuctionSeason(verifiedRunLeader, 2025).batting.evidence.some((item) => item.includes("verified IPL 2025 runs")));
  assert.equal(verifiedRunLeader.simulationRatings.batting.status, "verified-data-derived");
  assert.equal(verifiedRunLeader.simulationRatings.wicketkeeping.status, "estimated");
  assert.equal(verifiedRunLeader.simulationRatings.powerplayBatting.status, "estimated");
  assert.equal(verifiedRunLeader.simulationRatings.finishing.status, "estimated");
  assert.ok(verifiedRunLeader.missingFields.includes("ipl2025.batting.average"));
});

test("offline verified-stat source records have exact identities, unique fields, and source cutoffs", () => {
  assert.deepEqual(validateVerifiedStatRecords(VERIFIED_STAT_RECORDS, PLAYERS), []);
  assert.ok(validateVerifiedStatRecords([
    ...VERIFIED_STAT_RECORDS,
    VERIFIED_STAT_RECORDS[0]
  ], PLAYERS).some((error) => error.includes("Duplicate verified statistic record")));
  assert.ok(validateVerifiedStatRecords([
    { ...VERIFIED_STAT_RECORDS[0], playerName: "Sai Sudarshan" }
  ], PLAYERS).some((error) => error.includes("Unknown canonical player identity")));
  assert.ok(validateVerifiedStatRecords([
    { ...VERIFIED_STAT_RECORDS[0], source: { name: "Unattributed" } }
  ], PLAYERS).some((error) => error.includes("Missing source, cutoff, or verifiedAt")));
});

test("overlapping curated groups preserve all-rounder and wicketkeeper evaluation roles", () => {
  const darylMitchell = resolvePlayerAlias("Daryl Mitchell");
  const rahulTewatia = resolvePlayerAlias("Rahul Tewatia");
  const rishabhPant = resolvePlayerAlias("Rishabh Pant");
  assert.equal(darylMitchell.role, "allrounder");
  assert.ok(darylMitchell.roleGroups.includes("batter"));
  assert.ok(darylMitchell.roleGroups.includes("allrounder"));
  assert.equal(rahulTewatia.role, "allrounder");
  assert.equal(rishabhPant.role, "wicketkeeper");
  const evaluation = evaluatePlayerValue({
    player: darylMitchell,
    team: engineFor().teams.CSK,
    remainingPlayers: [],
    rules: CUSTOM_RULES
  });
  assert.equal(evaluation.skillRatings.batting, darylMitchell.simulationRatings.batting.value);
  assert.equal(evaluation.skillRatings.bowling, darylMitchell.simulationRatings.bowling.value);
});

test("auction, retention history, and AI valuation consume the canonical player profile", () => {
  const player = resolvePlayerAlias("Ruturaj Gaikwad");
  const history = createSampleHistory(PLAYERS);
  const retainedCandidate = history.CSK.find((record) => record.id === player.id);
  const engine = new AuctionEngine({ players: [player], userTeam: "MI", randomized: false });
  const auctionPlayer = engine.queue.find((record) => record.id === player.id);
  assert.equal(retainedCandidate, player);
  assert.deepEqual(auctionPlayer.statistics, player.statistics);
  assert.deepEqual(auctionPlayer.simulationRatings, player.simulationRatings);
  const evaluation = evaluatePlayerValue({
    player: auctionPlayer,
    team: engine.teams.MI,
    remainingPlayers: [],
    rules: CUSTOM_RULES
  });
  assert.equal(evaluation.skillRatings.batting, player.simulationRatings.batting.value);
  assert.equal(player.statistics.iplCareer.batting.runs, null);
  assert.equal(player.statistics.ipl2025.batting.runs, null);
});

test("catalogue filters by name, franchise, role, nationality, ranges, and simulation status", () => {
  const kohli = PLAYERS.find((player) => player.name === "Virat Kohli");
  assert.deepEqual(filterCatalogue(PLAYERS, { query: "virat kohli", role: "batter" }).map((player) => player.id), [kohli.id]);
  const rcbRecords = filterCatalogue(PLAYERS, { franchise: "RCB" });
  assert.ok(rcbRecords.length > 0);
  assert.ok(rcbRecords.every((player) => verifiedFranchiseForCatalogue(player) === "RCB"));
  const overseasBowlers = filterCatalogue(PLAYERS, { nationality: "Overseas", role: "bowler" });
  assert.ok(overseasBowlers.length > 0);
  assert.ok(overseasBowlers.every((player) => player.isOverseas && player.role === "bowler"));
  const affordable = filterCatalogue(PLAYERS, { minimumPrice: "100", maximumPrice: "100", minimumRating: "60" });
  assert.ok(affordable.length > 0);
  assert.ok(affordable.every((player) => player.basePrice === 100 && player.rating >= 60));
  assert.deepEqual(filterCatalogue(PLAYERS, { status: "skipped" }, (player) => player.id === kohli.id ? "skipped" : "eligible").map((player) => player.id), [kohli.id]);
});

test("catalogue statistics remain N/A unless verified and can sort verified values", () => {
  const unverified = PLAYERS.find((player) => !player.statsVerified);
  assert.equal(verifiedStatForCatalogue(unverified, "runs"), null);
  const records = [
    { ...PLAYERS[0], id: "stat-a", statsVerified: true, historicalStats: { runs: 40 } },
    { ...PLAYERS[1], id: "stat-b", statsVerified: true, historicalStats: { runs: 10 } },
    { ...PLAYERS[2], id: "stat-c", statsVerified: false, historicalStats: { runs: 999 } }
  ];
  assert.deepEqual(filterCatalogue(records, { sort: "runs" }).map((player) => player.id), ["stat-b", "stat-a", "stat-c"]);
});

test("user target plans enforce eligibility, spending limits, priorities, and persist in snapshots", () => {
  const first = PLAYERS.find((player) => player.role === "bowler" && player.category === "Grade A");
  const second = PLAYERS.find((player) => player.role === "batter" && player.category === "Grade A");
  const plan = [
    { playerId: first.id, priority: "primary", spendLimit: first.basePrice + 100, rolePriority: 1 },
    { playerId: second.id, priority: "backup", spendLimit: second.basePrice, rolePriority: 2 }
  ];
  assert.equal(plannedSpend(validateUserTargetPlan(plan, PLAYERS)), first.basePrice + 100 + second.basePrice);
  const engine = engineFor({ userTargetPlan: plan });
  const resumed = engineFor({ snapshot: engine.snapshot() });
  assert.deepEqual(resumed.userTargetPlan, engine.userTargetPlan);
  assert.throws(() => validateUserTargetPlan([
    { ...plan[0], spendLimit: first.basePrice - 1 }
  ], PLAYERS), /between base price and available purse/);
  assert.throws(() => validateUserTargetPlan([
    plan[0], { ...plan[0], priority: "secondary" }
  ], PLAYERS), /appears more than once/);
  assert.throws(() => validateUserTargetPlan(plan, PLAYERS, { retainedIds: new Set([first.id]) }), /retained and cannot/);
});

test("all ten franchises are present and purse defaults use integer lakh units", () => {
  assert.equal(FRANCHISES.length, 10);
  assert.equal(CUSTOM_RULES.purse, 12000);
});

test("final-call duration defaults to seven seconds and stays within five to ten", () => {
  assert.equal(normalizeFinalCallDuration(), 7);
  assert.equal(normalizeFinalCallDuration(3), 5);
  assert.equal(normalizeFinalCallDuration(8.7), 9);
  assert.equal(normalizeFinalCallDuration(14), 10);
  assert.equal(normalizeFinalCallDuration("invalid"), 7);
  for (const seconds of [5, 6, 7, 8, 9, 10]) {
    const stages = finalCallStageDurations(seconds);
    assert.equal(stages.toGoingTwiceMs + stages.toFinalCallMs + stages.finalCallMs, seconds * 1000);
    assert.equal(stages.totalMs, seconds * 1000);
    assert.ok(stages.finalCallMs >= 1000);
  }
});

test("IPL 2026 retained roster has the published team counts and season-specific associations", () => {
  const expectedCounts = { CSK: 16, DC: 17, GT: 20, KKR: 12, LSG: 19, MI: 20, PBKS: 21, RR: 16, RCB: 17, SRH: 15 };
  const expectedOverseasCounts = { CSK: 4, DC: 3, GT: 4, KKR: 2, LSG: 4, MI: 7, PBKS: 6, RR: 7, RCB: 6, SRH: 6 };
  assert.equal(IPL_2026_RETAINED_PLAYERS.length, 173);
  assert.deepEqual(
    Object.fromEntries(FRANCHISES.map(({ code }) => [
      code, IPL_2026_RETAINED_PLAYERS.filter((record) => record.teamCode === code).length
    ])),
    expectedCounts
  );
  assert.deepEqual(
    Object.fromEntries(FRANCHISES.map(({ code }) => [
      code, IPL_2026_RETAINED_PLAYERS.filter((record) => record.teamCode === code && record.overseas).length
    ])),
    expectedOverseasCounts
  );
  for (const record of IPL_2026_RETAINED_PLAYERS) {
    const player = PLAYERS.find((item) => item.season2026SourceName === record.sourceName);
    assert.ok(player, `missing catalogue record for ${record.name}`);
    assert.equal(player.season2026FranchiseCode, record.teamCode);
    assert.equal(player.season2026AssociationStatus, "verified");
    assert.equal(player.season2026SquadStatus, "retained");
    assert.equal(player.season2026TradeStatus, record.traded ? "traded" : "not-marked-as-traded");
    assert.equal(player.isOverseas, record.overseas);
    assert.equal(player.originalFranchiseCode, null);
    assert.equal(player.previousFranchiseCode, null);
    assert.equal(player.auctionStatus, "retained-before-2026-auction");
  }
  assert.ok(PLAYERS.some((player) =>
    player.season2026SquadStatus === "unknown" &&
    player.season2026AssociationStatus === "unknown"
  ));
  const seasonHistory = createSampleHistory(PLAYERS);
  for (const team of FRANCHISES) {
    const prepared = buildTeamsAfterRetention({
      mode: "Mega Auction",
      sampleHistory: seasonHistory,
      userTeam: team.code,
      userRetainedIds: [seasonHistory[team.code][0].id]
    });
    assert.ok(prepared.teams[team.code].squad.every((player) =>
      player.season2026FranchiseCode === team.code
    ));
    assert.equal(prepared.teams[team.code].purse, CUSTOM_RULES.purse - retentionCost("Mega Auction", 1));
    assert.equal(prepared.teams[team.code].retention.slotsUsed, 1);
    assert.equal(prepared.teams[team.code].retention.totalCost, retentionCost("Mega Auction", 1));
  }
});

test("selected auction season excludes future-only verified retention records", () => {
  const futureOnly = PLAYERS.find((player) => player.season2026AssociationStatus === "verified" &&
    !player.seedFranchiseCodes?.includes(player.season2026FranchiseCode));
  assert.ok(futureOnly);
  const teamCode = futureOnly.season2026FranchiseCode;
  assert.equal(isRetentionCandidateFor(futureOnly, teamCode, 2025), false);
  assert.equal(isRetentionCandidateFor(futureOnly, teamCode, 2026), true);
  assert.equal(createSampleHistory([futureOnly], { auctionSeason: 2025 })[teamCode].length, 0);
  assert.equal(createSampleHistory([futureOnly], { auctionSeason: 2026 })[teamCode].length, 1);
  const startingTeams = createFranchiseState();
  startingTeams[teamCode].retention.releasedPlayers = [{
    playerId: futureOnly.id,
    playerName: futureOnly.name,
    releasedBy: teamCode,
    status: "released",
    auctionEligibility: "base-price-configured"
  }];
  const earlierEngine = new AuctionEngine({
    players: [futureOnly],
    userTeam: "MI",
    auctionSeason: 2025,
    startingTeams,
    randomized: false
  });
  assert.equal(earlierEngine.queue[0].releasedBy, teamCode);
  assert.equal(earlierEngine.queue[0].rtmEligible, false);
});

test("bid increments scale with the live price and preserve legal opening prices", () => {
  assert.equal(nextBidAmount(0, 200), 200);
  assert.equal(nextBidAmount(200, 200), 225);
  assert.equal(nextBidAmount(500, 200), 550);
  assert.equal(nextBidAmount(2000, 200), 2100);
  assert.equal(nextBidAmount(5000, 200), 5200);
});

test("seeded Fisher-Yates shuffle is repeatable and does not mutate the source", () => {
  const source = [1, 2, 3, 4, 5];
  const a = shuffle(source, createSeededRandom(7));
  const b = shuffle(source, createSeededRandom(7));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), source);
  assert.deepEqual(source, [1, 2, 3, 4, 5]);
});

test("auction queue preserves category groups and includes each player exactly once", () => {
  const queue = createAuctionOrder(PLAYERS, { randomized: true, seed: 12 });
  const pricedPlayers = PLAYERS.filter((player) => Number.isInteger(player.basePrice));
  assert.equal(queue.length, pricedPlayers.length);
  assert.equal(new Set(queue.map((player) => player.id)).size, pricedPlayers.length);
  assert.ok(PLAYERS.filter((player) => player.basePrice === null).every((player) =>
    !queue.some((lot) => lot.id === player.id)
  ));
  assert.ok(queue.every((player) => player.auctionSetNumber > 0 && player.auctionSetName === player.auctionCategory));
  assert.ok(queue.every((player) => player.auctionCatalogueStatus.includes("custom simulation order")));
  const firstNonMarquee = queue.findIndex((player) => !player.category.startsWith("Marquee "));
  assert.ok(queue.slice(0, firstNonMarquee).every((player) => player.category.startsWith("Marquee ")));
  const excluded = createAuctionOrder([
    { ...PLAYERS[0], id: "retained-state", auctionStatus: "RETAINED" },
    { ...PLAYERS[1], id: "sold-state", auctionStatus: "SOLD" },
    { ...PLAYERS[2], id: "unsold-state", auctionStatus: "UNSOLD" },
    { ...PLAYERS[3], id: "eligible-state", auctionStatus: "AVAILABLE_FOR_AUCTION" }
  ], { randomized: false });
  assert.deepEqual(excluded.map((player) => player.id), ["eligible-state"]);
});

test("verified former franchise may match the live bid with an optional persisted RTM right", () => {
  const sourcePlayer = PLAYERS.find((item) => Number.isInteger(item.basePrice) &&
    item.role !== "unknown" && item.season2026AssociationStatus !== "verified");
  const player = {
    ...sourcePlayer,
    previousFranchiseCode: "CSK",
    previousFranchiseStatus: "verified"
  };
  const startingTeams = buildTeamsAfterRetention({
    mode: "Mega Auction",
    sampleHistory: createSampleHistory([player]),
    userTeam: "CSK",
    userRetainedIds: []
  }).teams;
  const engine = new AuctionEngine({
    players: [player],
    userTeam: "CSK",
    randomized: false,
    startingTeams,
    rtmEnabled: true,
    rtmLimit: 1
  });
  startBidding(engine);
  assert.equal(engine.currentPlayer.rtmEligible, true);
  assert.equal(engine.bid("MI"), true);
  const matchedAmount = engine.currentBid;
  assert.equal(engine.closeLot(), true);
  assert.equal(engine.state, GAME_STATES.RTM_PENDING);
  const pendingSave = engine.snapshot();
  const restored = new AuctionEngine({
    players: [player],
    userTeam: "CSK",
    randomized: false,
    snapshot: pendingSave
  });
  assert.equal(restored.state, GAME_STATES.RTM_PENDING);
  assert.equal(restored.pendingRTM.teamCode, "CSK");
  assert.equal(restored.pause(), true);
  assert.equal(restored.resolveRTM("CSK", true), false);
  assert.equal(restored.resume(), true);
  assert.equal(restored.resolveRTM("CSK", true), true);
  assert.equal(restored.state, GAME_STATES.SOLD);
  assert.equal(restored.leadingTeam, "CSK");
  assert.equal(restored.history.at(-1).amount, matchedAmount);
  assert.equal(restored.history.at(-1).rtm, true);
  assert.equal(restored.teams.CSK.purse, CUSTOM_RULES.purse - matchedAmount);
  assert.equal(restored.rtmUsedByTeam.CSK, 1);
  assert.equal(restored.resolveRTM("CSK", true), false);
});

test("declined RTM preserves the original highest bidder and unknown seed owners have no RTM right", () => {
  const player = PLAYERS.find((item) => Number.isInteger(item.basePrice) &&
    item.role !== "unknown" && item.season2026AssociationStatus !== "verified");
  const engine = engineFor({ players: [player], eligiblePlayers: [player], rtmEnabled: true });
  startBidding(engine);
  assert.equal(engine.currentPlayer.rtmEligible, false);
  assert.equal(engine.bid("MI"), true);
  assert.equal(engine.closeLot(), true);
  assert.equal(engine.state, GAME_STATES.SOLD);
  assert.equal(engine.leadingTeam, "MI");

  const verifiedPlayer = { ...player, originalFranchiseCode: "CSK", originalFranchiseStatus: "verified" };
  const startingTeams = buildTeamsAfterRetention({
    mode: "Mega Auction",
    sampleHistory: createSampleHistory([verifiedPlayer]),
    userTeam: "CSK",
    userRetainedIds: []
  }).teams;
  const declining = new AuctionEngine({
    players: [verifiedPlayer],
    userTeam: "CSK",
    randomized: false,
    startingTeams,
    rtmEnabled: true
  });
  startBidding(declining);
  assert.equal(declining.bid("MI"), true);
  assert.equal(declining.closeLot(), true);
  assert.equal(declining.resolveRTM("CSK", false), true);
  assert.equal(declining.leadingTeam, "MI");
  assert.equal(declining.teams.MI.purse, CUSTOM_RULES.purse - player.basePrice);
  assert.equal(declining.teams.CSK.purse, CUSTOM_RULES.purse);
});

test("bidding remains closed until the full player introduction completes for its lot", () => {
  const engine = engineFor({ players: [PLAYERS[0]], eligiblePlayers: [PLAYERS[0]] });
  engine.startLot();
  const player = engine.startLot();
  const lotId = `${engine.index}:${player.id}`;
  assert.equal(engine.state, GAME_STATES.INTRODUCING);
  assert.equal(engine.bid("MI"), false);
  assert.equal(engine.openBidding("stale-lot"), false);
  assert.equal(engine.openBidding(lotId), true);
  assert.equal(engine.state, GAME_STATES.BIDDING_OPEN);
  assert.equal(engine.canBid("MI"), true);
});

test("passing withdraws only the user's franchise without finalizing or charging", () => {
  const engine = engineFor();
  startBidding(engine);
  assert.equal(engine.pass("CSK"), true);
  assert.equal(engine.pass("CSK"), false);
  assert.equal(engine.canBid("CSK"), false);
  assert.equal(engine.canBid("MI"), true);
  assert.equal(engine.teams.CSK.purse, CUSTOM_RULES.purse);
  assert.equal(engine.finalized.size, 0);
  assert.equal(engine.state, GAME_STATES.BIDDING_OPEN);
});

test("skip finalizes exactly once, cancels a leading bid without charging, and advances", () => {
  const engine = engineFor();
  const firstPlayer = startBidding(engine);
  const nextPlayer = engine.queue[engine.index + 1];
  assert.equal(engine.bid("MI"), true);
  const purseBeforeSkip = engine.teams.MI.purse;
  assert.equal(engine.skip(), true);
  assert.equal(engine.state, GAME_STATES.SKIPPED);
  assert.equal(engine.currentPlayer.auctionStatus, "SKIPPED");
  assert.equal(engine.finalized.has(firstPlayer.id), true);
  assert.equal(engine.teams.MI.purse, purseBeforeSkip);
  assert.equal(engine.teams.MI.squad.some((player) => player.id === firstPlayer.id), false);
  assert.equal(engine.history.filter((item) =>
    item.playerId === firstPlayer.id && item.result === "skipped" && item.skipReason === "USER_SKIPPED"
  ).length, 1);
  assert.equal(engine.skip(), false);
  assert.equal(engine.closeLot(), false);
  assert.equal(engine.nextLot(), true);
  assert.equal(engine.currentPlayer.id, nextPlayer.id);
  assert.equal(engine.finalized.has(firstPlayer.id), true);
});

test("skipping is blocked while paused and can resume afterward", () => {
  const engine = engineFor();
  const player = startBidding(engine);
  assert.equal(engine.pause(), true);
  assert.equal(engine.skip(), false);
  assert.equal(engine.finalized.has(player.id), false);
  assert.equal(engine.resume(), true);
  assert.equal(engine.skip(), true);
  assert.equal(engine.state, GAME_STATES.SKIPPED);
});

test("pause holds terminal result display and blocks progression until resumed", () => {
  const engine = engineFor({ players: [PLAYERS[0], PLAYERS[1]], eligiblePlayers: [PLAYERS[0], PLAYERS[1]] });
  const first = startBidding(engine);
  assert.equal(engine.bid("MI"), true);
  assert.equal(engine.closeLot(), true);
  assert.equal(engine.state, GAME_STATES.SOLD);
  assert.equal(engine.pause(), true);
  assert.equal(engine.nextLot(), false);
  assert.equal(engine.currentPlayer.id, first.id);
  assert.equal(engine.resume(), true);
  assert.equal(engine.nextLot(), true);
  assert.equal(engine.currentPlayer.id, PLAYERS[1].id);
});

test("skipping preserves marquee order and advances to the next category only after marquee lots", () => {
  const marqueePlayers = PLAYERS.filter((player) => player.category?.startsWith("Marquee "));
  const first = marqueePlayers[0];
  const second = marqueePlayers[1];
  const nextCategoryPlayer = PLAYERS.find((player) => player.category && !player.category.startsWith("Marquee "));
  const engine = engineFor({
    players: [first, second, nextCategoryPlayer],
    eligiblePlayers: [first, second, nextCategoryPlayer]
  });
  startBidding(engine);
  assert.equal(engine.currentPlayer.id, first.id);
  assert.equal(engine.skip(), true);
  assert.equal(engine.nextLot(), true);
  assert.equal(engine.currentPlayer.id, second.id);
  assert.equal(engine.state, GAME_STATES.INTRODUCING);
  assert.equal(engine.openBidding(`${engine.index}:${second.id}`), true);
  assert.equal(engine.skip(), true);
  assert.equal(engine.nextLot(), true);
  assert.equal(engine.state, GAME_STATES.READY);
  assert.equal(engine.currentPlayer.id, nextCategoryPlayer.id);
});

test("stale lot callbacks from a skipped player cannot advance or sell a later lot", () => {
  const engine = engineFor({
    players: [PLAYERS[0], PLAYERS[1]],
    eligiblePlayers: [PLAYERS[0], PLAYERS[1]],
    randomized: false
  });
  const firstPlayer = startBidding(engine);
  assert.equal(engine.bid("MI"), true);
  assert.equal(engine.skip(), true);
  assert.equal(engine.nextLot(), true);
  const secondPlayer = engine.currentPlayer;
  assert.equal(engine.openBidding(`${engine.index}:${secondPlayer.id}`), true);
  const staleLotId = `${0}:${firstPlayer.id}`;
  assert.equal(engine.goingOnce(staleLotId), false);
  assert.equal(engine.closeLot(staleLotId), false);
  assert.equal(engine.state, GAME_STATES.BIDDING_OPEN);
  assert.equal(engine.currentPlayer.id, secondPlayer.id);
  assert.equal(engine.teams.MI.purse, CUSTOM_RULES.purse);
});

test("skipping the final player completes the auction and restores from a saved skipped result", () => {
  const player = PLAYERS.find((item) => item.category === "Grade A");
  const engine = engineFor({ players: [player], eligiblePlayers: [player] });
  startBidding(engine);
  assert.equal(engine.skip(), true);
  const resumed = engineFor({ players: [player], eligiblePlayers: [player], snapshot: engine.snapshot() });
  assert.equal(resumed.state, GAME_STATES.SKIPPED);
  assert.equal(resumed.currentPlayer.id, player.id);
  assert.equal(resumed.currentPlayer.auctionStatus, "SKIPPED");
  assert.equal(resumed.progressFor().skipped, 1);
  assert.equal(resumed.nextLot(), true);
  assert.equal(resumed.state, GAME_STATES.COMPLETE);
});

test("winner pays exactly once, loser does not pay, and repeat closure is rejected", () => {
  const engine = engineFor();
  startBidding(engine);
  const player = engine.currentPlayer;
  const winner = engine.canBid("CSK") ? "CSK" : "MI";
  assert.equal(engine.bid(winner), true);
  const amount = engine.currentBid;
  const other = winner === "CSK" ? "MI" : "CSK";
  const otherPurse = engine.teams[other].purse;
  assert.equal(engine.closeLot(), true);
  assert.equal(engine.closeLot(), false);
  assert.equal(engine.teams[winner].purse, CUSTOM_RULES.purse - amount);
  assert.equal(engine.teams[other].purse, otherPurse);
  assert.equal(engine.teams[winner].squad.filter((item) => item.id === player.id).length, 1);
  assert.equal(engine.teams[winner].squad[0].currentOwner, winner);
  assert.equal(engine.teams[winner].squad[0].auctionStatus, "SOLD");
});

test("a no-bid lot closes unsold without charging any franchise", () => {
  const engine = engineFor();
  startBidding(engine);
  for (const team of FRANCHISES) engine.pass(team.code);
  const purse = engine.teams.CSK.purse;
  assert.equal(engine.closeLot(), true);
  assert.equal(engine.state, GAME_STATES.UNSOLD);
  assert.equal(engine.teams.CSK.purse, purse);
  assert.equal(engine.history.at(-1).result, "unsold");
});

test("going-once and going-twice remain bid-open and a new bid resets the countdown", () => {
  const engine = engineFor();
  startBidding(engine);
  assert.equal(engine.bid("MI"), true);
  assert.equal(engine.goingOnce(), true);
  assert.equal(engine.state, GAME_STATES.GOING_ONCE);
  assert.equal(engine.canBid("RCB"), true);
  assert.equal(engine.bid("RCB"), true);
  assert.equal(engine.state, GAME_STATES.BIDDING_OPEN);
  assert.equal(engine.goingTwice(), false);
});

test("final call opens a last legal bid window and an accepted bid cancels the closing state", () => {
  const engine = engineFor();
  startBidding(engine);
  assert.equal(engine.bid("MI"), true);
  assert.equal(engine.goingOnce(), true);
  assert.equal(engine.goingTwice(), true);
  assert.equal(engine.finalCall(), true);
  assert.equal(engine.state, GAME_STATES.FINAL_CALL);
  assert.equal(engine.canBid("RCB"), true);
  assert.equal(engine.bid("RCB"), true);
  assert.equal(engine.state, GAME_STATES.BIDDING_OPEN);
  assert.equal(engine.leadingTeam, "RCB");
  assert.equal(engine.finalCall(), false);
});

test("auction reaches completion after every lot is safely finalized", () => {
  const engine = new AuctionEngine({ players: [PLAYERS[0]], userTeam: "CSK", randomized: false });
  startBidding(engine);
  for (const team of FRANCHISES) engine.pass(team.code);
  assert.equal(engine.closeLot(), true);
  assert.equal(engine.nextLot(), true);
  assert.equal(engine.state, GAME_STATES.COMPLETE);
  assert.equal(engine.currentPlayer, null);
  assert.equal(engine.progressFor().unsold, 1);
});

test("saved auction restores exact queue, current player, purse, and squad", () => {
  const engine = engineFor({ randomized: true, seed: 99 });
  startBidding(engine);
  const bidder = engine.canBid("CSK") ? "CSK" : "MI";
  engine.bid(bidder);
  engine.closeLot();
  const snapshot = engine.snapshot();
  const resumed = engineFor({ snapshot });
  assert.deepEqual(resumed.queue.map((player) => player.id), engine.queue.map((player) => player.id));
  assert.equal(resumed.currentPlayer.id, engine.currentPlayer.id);
  assert.deepEqual(resumed.teams, engine.teams);
  const altered = engine.snapshot();
  const winner = altered.leadingTeam;
  altered.teams[winner].squad[0].isOverseas = true;
  const normalized = engineFor({ snapshot: altered });
  assert.equal(normalized.teams[winner].squad[0].isOverseas, PLAYERS.find((player) => player.id === altered.teams[winner].squad[0].id).isOverseas);
});

test("selected auction season persists across save and restore", () => {
  const player = PLAYERS[0];
  const engine = engineFor({ auctionSeason: 2025, players: [player], eligiblePlayers: [player] });
  const resumed = engineFor({ players: [player], eligiblePlayers: [player], snapshot: engine.snapshot() });
  assert.equal(engine.snapshot().auctionSeason, 2025);
  assert.equal(resumed.auctionSeason, 2025);
  assert.throws(() => engineFor({ auctionSeason: 2027 }), /season must be 2025 or 2026/);
});

test("invalid saved player references are rejected", () => {
  const engine = engineFor();
  const snapshot = engine.snapshot();
  snapshot.queueIds[0] = "unknown-player";
  assert.throws(() => engineFor({ snapshot }), /unknown players/);
});

test("overseas and squad limits are enforced before accepting a bid", () => {
  const overseasPlayer = { ...PLAYERS[0], isOverseas: true };
  const engine = new AuctionEngine({ players: [overseasPlayer], userTeam: "CSK", randomized: false });
  startBidding(engine);
  engine.teams.CSK.squad = Array.from({ length: CUSTOM_RULES.maxOverseas }, (_, index) => ({
    ...PLAYERS[index + 1], isOverseas: true
  }));
  assert.equal(engine.canBid("CSK"), false);
  engine.teams.CSK.squad = Array.from({ length: 25 }, (_, index) => ({ ...PLAYERS[index + 1], isOverseas: false }));
  engine.teams.CSK.purse = CUSTOM_RULES.purse;
  assert.equal(engine.canBid("CSK"), false);
});

test("saved auction rejects duplicate queue entries and inconsistent purse totals", () => {
  const engine = engineFor();
  const duplicateQueue = engine.snapshot();
  duplicateQueue.queueIds[1] = duplicateQueue.queueIds[0];
  assert.throws(() => engineFor({ snapshot: duplicateQueue }), /duplicate queue/);
  const inconsistentPurse = engine.snapshot();
  inconsistentPurse.teams.CSK.purse -= 1;
  assert.throws(() => engineFor({ snapshot: inconsistentPurse }), /does not match its purchases/);
});

test("valuation uses ratings, verified stats, role gaps, scarcity, and strategy", () => {
  const player = PLAYERS.find((item) => item.name === "Virat Kohli");
  const team = engineFor().teams.CSK;
  const base = evaluatePlayerValue({ player, team, remainingPlayers: [], difficulty: "Normal", rules: CUSTOM_RULES });
  const withVerifiedHistory = evaluatePlayerValue({
    player: { ...player, statsVerified: true, historicalStats: { battingImpact: 8, bowlingImpact: 0 } },
    team,
    remainingPlayers: [],
    difficulty: "Normal",
    rules: CUSTOM_RULES
  });
  assert.ok(base.estimatedValue > player.basePrice);
  assert.ok(withVerifiedHistory.estimatedValue > base.estimatedValue);
  assert.ok(base.roleNeed > 0);
  assert.ok(base.scarcity > 1);
  assert.ok(base.valueRange.minimum <= base.estimatedValue);
  assert.ok(base.estimatedValue <= base.valueRange.maximum);
  assert.ok(base.risks.length > 0);
  assert.equal(base.recommendedBidLimit, base.strategicCeiling);
});

test("AI bids marquee players above base when strategic value and budget permit", () => {
  const player = PLAYERS.find((item) => item.name === "Virat Kohli");
  const engine = new AuctionEngine({ players: [player], userTeam: "CSK", randomized: false, difficulty: "Hard" });
  startBidding(engine);
  const bids = [];
  for (let round = 0; round < 14; round += 1) {
    for (const team of FRANCHISES.filter((item) => item.code !== "CSK")) {
      if (engine.aiDecision(team.code)) bids.push({ teamCode: team.code, amount: engine.currentBid });
    }
  }
  assert.ok(bids.length >= 3, `expected competitive AI responses, got ${bids.length}`);
  assert.ok(engine.currentBid > player.basePrice);
  assert.ok(bids.some((bid) => bid.teamCode !== bids[0].teamCode));
  for (const bid of bids) assert.ok(bid.amount <= CUSTOM_RULES.purse);
});

test("AI ceilings respect legal purse, mandatory squad reserve, role needs, and withdrawal", () => {
  const player = PLAYERS.find((item) => item.name === "Virat Kohli");
  const engine = engineFor();
  const team = engine.teams.MI;
  const decision = aiBidDecision({
    player,
    team,
    remainingPlayers: [player],
    currentBid: 0,
    nextBid: player.basePrice,
    difficulty: "Hard",
    rules: CUSTOM_RULES
  });
  assert.equal(reserveForMandatorySlots(team, CUSTOM_RULES), 340);
  assert.ok(legalMaximumBid(team, player, CUSTOM_RULES) <= team.purse - 340);
  assert.ok(decision.roleNeed > 0);
  startBidding(engine);
  assert.equal(engine.pass("MI"), true);
  assert.equal(engine.aiDecision("MI"), false);
  assert.equal(engine.canBid("MI"), false);
});

test("role need changes valuation and personalities have distinct risk ceilings", () => {
  const player = PLAYERS.find((item) => item.name === "Jasprit Bumrah");
  const balanced = engineFor().teams.CSK;
  const bowling = engineFor().teams.SRH;
  const filled = { ...balanced, squad: Array.from({ length: 7 }, () => ({ ...player, role: "bowler" })) };
  const lowNeed = evaluatePlayerValue({ player, team: filled, remainingPlayers: [], rules: CUSTOM_RULES });
  const highNeed = evaluatePlayerValue({ player, team: bowling, remainingPlayers: [], rules: CUSTOM_RULES });
  assert.ok(highNeed.estimatedValue > lowNeed.estimatedValue);
  assert.notEqual(highNeed.recommendedBidLimit, lowNeed.recommendedBidLimit);
  assert.notEqual(balanced.strategy.riskTolerance, bowling.strategy.riskTolerance);
});

test("all franchises retain independently with the configured costs and retained players are excluded", () => {
  const ownershipRecords = FRANCHISES.flatMap((team, teamIndex) =>
    PLAYERS.slice(teamIndex * 3, teamIndex * 3 + 3).map((player) => ({
      ...player,
      seedFranchiseCodes: [],
      season2026AssociationStatus: "unverified",
      originalFranchiseCode: team.code,
      originalFranchiseStatus: "verified"
    }))
  );
  const history = createSampleHistory([
    ...ownershipRecords,
    {
      ...PLAYERS[30],
      seedFranchiseCodes: [],
      season2026AssociationStatus: "unverified",
      originalFranchiseCode: "CSK",
      originalFranchiseStatus: "unverified"
    },
    {
      ...PLAYERS[31],
      seedFranchiseCodes: [],
      season2026AssociationStatus: "unverified",
      originalFranchiseCode: "INVALID",
      originalFranchiseStatus: "verified"
    }
  ]);
  assert.ok(FRANCHISES.every((team) =>
    history[team.code].length === 3 &&
    history[team.code].every((player) => player.originalFranchiseCode === team.code)
  ));
  assert.equal(retentionLimit("Mega Auction"), 3);
  assert.equal(retentionLimit("Mini Auction"), 5);
  const defaults = buildTeamsAfterRetention({
    mode: "Mega Auction",
    sampleHistory: createSampleHistory(PLAYERS),
    userTeam: "CSK",
    userRetainedIds: []
  });
  const aiTeams = FRANCHISES.filter((team) => team.code !== "CSK");
  assert.ok(aiTeams.every((team) => defaults.teams[team.code].retention.slotsUsed === 3));
  assert.ok(aiTeams.every((team) =>
    defaults.teams[team.code].retention.retainedPlayers.every((retained) => {
      const player = PLAYERS.find((candidate) => candidate.id === retained.id);
      return player && isRetentionCandidateFor(player, team.code) &&
        retained.cost === [1800, 1400, 1100][retained.slot - 1];
    })
  ));
  const recommendations = recommendFranchiseRetentions({
    sampleHistory: createSampleHistory(PLAYERS),
    mode: "Mega Auction",
    userTeam: "CSK"
  });
  assert.deepEqual(recommendations.CSK.retainedIds, []);
  assert.ok(aiTeams.every((team) => recommendations[team.code].retainedIds.length === 3));
  const advisedIds = aiTeams.flatMap((team) => recommendations[team.code].retainedIds);
  assert.equal(new Set(advisedIds).size, advisedIds.length);
  assert.ok(aiTeams.every((team) => recommendations[team.code].decisions.every((decision) =>
    decision.reasons.length > 0 && decision.confidence
  )));
  const recommendedSelections = Object.fromEntries(FRANCHISES.map(({ code }) => [
    code,
    recommendations[code].retainedIds
  ]));
  const advisedTeams = buildTeamsAfterRetention({
    mode: "Mega Auction",
    sampleHistory: createSampleHistory(PLAYERS),
    userTeam: "CSK",
    retainedIdsByTeam: recommendedSelections,
    retentionAdvice: recommendations
  }).teams;
  assert.ok(aiTeams.every((team) => advisedTeams[team.code].retention.advisorRecommendations.length === 3));
  const selected = history.CSK.slice(0, 3).map((player) => player.id);
  const prepared = buildTeamsAfterRetention({
    mode: "Mega Auction",
    sampleHistory: history,
    userTeam: "CSK",
    userRetainedIds: selected
  });
  assert.equal(prepared.teams.CSK.squad.length, 3);
  assert.equal(prepared.teams.CSK.purse, CUSTOM_RULES.purse - retentionCost("Mega Auction", 3));
  assert.deepEqual(prepared.teams.CSK.retention.retainedPlayerIds, selected);
  assert.deepEqual(prepared.teams.CSK.retention.retainedPlayerNames, prepared.teams.CSK.squad.map((player) => player.name));
  assert.deepEqual(prepared.teams.CSK.retention.retainedPlayers.map((player) => [player.slot, player.cost]), [
    [1, 1800], [2, 1400], [3, 1100]
  ]);
  assert.ok(prepared.teams.CSK.squad.every((player) =>
    player.purchasePrice === 0 &&
    player.retentionCost === prepared.teams.CSK.retention.retainedPlayers[player.purchaseOrder - 1].cost &&
    player.auctionStatus === "RETAINED" &&
    player.currentOwner === "CSK"
  ));
  assert.equal(prepared.teams.CSK.retention.remainingPurse, prepared.teams.CSK.purse);
  const retainedIds = FRANCHISES.flatMap((team) => prepared.teams[team.code].retention.retainedPlayerIds);
  assert.equal(retainedIds.length, 30);
  assert.ok(createSampleHistory(PLAYERS).CSK.length >= FRANCHISE_SEED_LISTS.CSK.split(",").length);
  assert.equal(new Set(retainedIds).size, retainedIds.length);
  assert.ok(FRANCHISES.every((team) =>
    prepared.teams[team.code].squad.length === 3 &&
    prepared.teams[team.code].squad.every((player) =>
      player.originalFranchiseCode === team.code &&
      player.currentOwner === team.code &&
      player.auctionStatus === "RETAINED"
    )
  ));
  for (const team of FRANCHISES) {
    const candidates = history[team.code];
    const selectedId = candidates[0].id;
    const result = buildTeamsAfterRetention({
      mode: "Mega Auction",
      sampleHistory: history,
      userTeam: team.code,
      userRetainedIds: [selectedId]
    });
    assert.ok(result.teams[team.code].squad.some((player) => player.id === selectedId));
    assert.ok(result.teams[team.code].squad.every((player) => player.originalFranchiseCode === team.code));
    assert.equal(result.teams[team.code].purse, CUSTOM_RULES.purse - retentionCost("Mega Auction", 1));
  }
  const otherFranchisePlayer = ownershipRecords.find((player) => player.originalFranchiseCode === "MI");
  const tamperedHistory = { ...history, CSK: [...history.CSK, otherFranchisePlayer] };
  assert.throws(() => buildTeamsAfterRetention({
    mode: "Mega Auction",
    sampleHistory: tamperedHistory,
    userTeam: "CSK",
    userRetainedIds: [otherFranchisePlayer.id]
  }), /ineligible player/);
  assert.throws(() => buildTeamsAfterRetention({
    mode: "Mega Auction",
    sampleHistory: history,
    userTeam: "CSK",
    userRetainedIds: ["not-a-valid-player"]
  }), /ineligible player/);
  assert.throws(() => buildTeamsAfterRetention({
    mode: "Mega Auction",
    sampleHistory: history,
    userTeam: "CSK",
    userRetainedIds: [...history.CSK.map((player) => player.id), "fourth-player"]
  }), /retention limit/);
  assert.ok(retainedIds.every((id) => FRANCHISES.filter((team) =>
    prepared.teams[team.code].squad.some((player) => player.id === id)
  ).length === 1));

  const testPlayers = [...ownershipRecords, ...PLAYERS.slice(ownershipRecords.length)];
  const retainedEngine = new AuctionEngine({
    players: testPlayers,
    eligiblePlayers: testPlayers,
    userTeam: "CSK",
    randomized: false,
    startingTeams: prepared.teams
  });
  assert.ok(retainedIds.every((id) => !retainedEngine.queue.some((player) => player.id === id)));
  assert.equal(new Set(retainedEngine.queue.map((player) => player.lotNumber)).size, retainedEngine.queue.length);
  const auctionPlayer = startBidding(retainedEngine);
  retainedEngine.currentPlayer.auctionStatus = "RETAINED";
  assert.equal(retainedEngine.canBid("MI"), false);
  assert.equal(retainedEngine.aiDecision("MI"), false);
  assert.equal(retainedEngine.closeLot(), false);
  retainedEngine.currentPlayer.auctionStatus = "AVAILABLE_FOR_AUCTION";
  assert.equal(retainedEngine.bid("CSK"), true);
  assert.equal(retainedEngine.closeLot(), true);
  assert.equal(retainedEngine.teams.CSK.retention.finalSquadPlayerIds.includes(auctionPlayer.id), true);
  assert.equal(retainedEngine.teams.CSK.retention.remainingPurse, CUSTOM_RULES.purse - retentionCost("Mega Auction", 3));
  const resumed = new AuctionEngine({
    players: testPlayers,
    eligiblePlayers: retainedEngine.queue,
    userTeam: "CSK",
    randomized: false,
    startingTeams: prepared.teams,
    snapshot: retainedEngine.snapshot()
  });
  assert.equal(resumed.teams.CSK.purse, retainedEngine.teams.CSK.purse);
  assert.equal(resumed.teams.CSK.squad.filter((player) => player.retained).length, 3);
  assert.ok(resumed.teams.CSK.squad.filter((player) => player.retained).every((player) =>
    player.currentOwner === "CSK" && player.auctionStatus === "RETAINED"
  ));
  assert.equal(resumed.teams.CSK.squad.find((player) => player.id === auctionPlayer.id).auctionStatus, "SOLD");
  for (const team of FRANCHISES) {
    assert.deepEqual(
      resumed.teams[team.code].retention.retainedPlayerIds,
      prepared.teams[team.code].retention.retainedPlayerIds
    );
    assert.equal(
      resumed.teams[team.code].retention.totalCost,
      prepared.teams[team.code].retention.totalCost
    );
  }
  assert.equal(resumed.teams.CSK.retention.remainingPurse, prepared.teams.CSK.retention.remainingPurse);
  assert.ok(resumed.teams.CSK.retention.finalSquadPlayerIds.includes(auctionPlayer.id));
  const mini = buildTeamsAfterRetention({
    mode: "Mini Auction",
    sampleHistory: history,
    userTeam: "CSK",
    userRetainedIds: []
  });
  assert.equal(mini.teams.CSK.purse, CUSTOM_RULES.purse);
});

test("ten franchise dashboards are derived from current engine squads and budgets", () => {
  const player = resolvePlayerAlias("Virat Kohli");
  const engine = engineFor({ eligiblePlayers: [player] });
  const current = startBidding(engine);
  assert.equal(current.id, player.id);
  assert.equal(engine.bid("CSK"), true);
  assert.equal(engine.closeLot(), true);
  const dashboards = FRANCHISES.map((team) => engine.getFranchiseDashboard(team.code));
  assert.equal(dashboards.length, 10);
  assert.equal(new Set(dashboards.map((dashboard) => dashboard.franchise.code)).size, 10);
  for (const dashboard of dashboards) {
    const state = engine.teams[dashboard.franchise.code];
    assert.equal(dashboard.purse, state.purse);
    assert.equal(dashboard.squadSize, state.squad.length);
    assert.equal(dashboard.remainingSlots, CUSTOM_RULES.maxSquad - state.squad.length);
    assert.equal(dashboard.retentionCost, state.retention.totalCost);
    assert.deepEqual(dashboard.squad, state.squad);
    assert.deepEqual(dashboard.releasedPlayers, state.retention.releasedPlayers);
  }
  const csk = engine.getFranchiseDashboard("CSK");
  assert.equal(csk.squadSize, 1);
  assert.equal(csk.purse, CUSTOM_RULES.purse - player.basePrice);
  assert.deepEqual(csk.purchasedPlayers.map((item) => item.id), [player.id]);
  assert.equal(engine.getFranchiseDashboard("INVALID"), null);
});

test("custom seed retention and release decisions persist and released players can be repurchased", () => {
  const sampleHistory = createSampleHistory(PLAYERS);
  const retainedPlayer = resolvePlayerAlias("Ruturaj Gaikwad");
  const releasedPlayer = resolvePlayerAlias("Ayush Mhatre");
  assert.ok(sampleHistory.CSK.some((player) => player.id === retainedPlayer.id));
  assert.ok(sampleHistory.CSK.some((player) => player.id === releasedPlayer.id));
  const retainedIdsByTeam = Object.fromEntries(FRANCHISES.map(({ code }) => [code, []]));
  retainedIdsByTeam.CSK = [retainedPlayer.id];
  const prepared = buildTeamsAfterRetention({
    mode: "Mega Auction",
    sampleHistory,
    userTeam: "CSK",
    retainedIdsByTeam
  });
  assert.equal(prepared.teams.CSK.squad[0].id, retainedPlayer.id);
  assert.equal(prepared.teams.CSK.squad[0].currentOwner, "CSK");
  assert.equal(prepared.teams.CSK.retention.totalCost, 1800);
  assert.equal(prepared.teams.CSK.purse, CUSTOM_RULES.purse - 1800);
  assert.ok(prepared.teams.CSK.retention.releasedPlayerIds.includes(releasedPlayer.id));
  assert.equal(prepared.teams.CSK.retention.releasedPlayers.find((record) =>
    record.playerId === releasedPlayer.id
  ).releasedBy, "CSK");

  const engine = new AuctionEngine({
    players: PLAYERS,
    eligiblePlayers: [releasedPlayer],
    userTeam: "CSK",
    randomized: false,
    startingTeams: prepared.teams
  });
  assert.equal(engine.queue.filter((player) => player.id === retainedPlayer.id).length, 0);
  assert.equal(engine.queue.filter((player) => player.id === releasedPlayer.id).length, 1);
  assert.equal(engine.queue[0].releasedBy, "CSK");
  const current = startBidding(engine);
  assert.equal(current.id, releasedPlayer.id);
  assert.equal(engine.canBid("CSK"), true);
  const purseBeforeSale = engine.teams.CSK.purse;
  assert.equal(engine.bid("CSK"), true);
  assert.equal(engine.closeLot(), true);
  assert.equal(engine.teams.CSK.purse, purseBeforeSale - releasedPlayer.basePrice);
  assert.equal(engine.teams.CSK.squad.filter((player) => player.id === releasedPlayer.id).length, 1);
  assert.equal(engine.closeLot(), false);
  assert.ok(engine.teams.CSK.retention.releasedPlayerIds.includes(releasedPlayer.id));
  assert.deepEqual(releasedPlayer.seedFranchiseCodes, resolvePlayerAlias("Ayush Mhatre").seedFranchiseCodes);

  const resumed = new AuctionEngine({
    players: PLAYERS,
    eligiblePlayers: engine.queue,
    userTeam: "CSK",
    randomized: false,
    snapshot: engine.snapshot()
  });
  assert.equal(resumed.teams.CSK.purse, engine.teams.CSK.purse);
  assert.equal(resumed.teams.CSK.retention.totalCost, 1800);
  assert.deepEqual(
    resumed.teams.CSK.retention.releasedPlayerIds,
    engine.teams.CSK.retention.releasedPlayerIds
  );
  assert.equal(resumed.teams.CSK.squad.filter((player) => player.id === releasedPlayer.id).length, 1);
  assert.equal(resumed.queue.find((player) => player.id === releasedPlayer.id).currentOwner, "CSK");
});

test("custom retention rejects duplicate ownership and over-limit selections", () => {
  const sampleHistory = createSampleHistory(PLAYERS);
  const originalHistory = structuredClone(sampleHistory);
  const retainedPlayer = resolvePlayerAlias("Ruturaj Gaikwad");
  const retainedIdsByTeam = Object.fromEntries(FRANCHISES.map(({ code }) => [code, []]));
  retainedIdsByTeam.CSK = [retainedPlayer.id];
  retainedIdsByTeam.MI = [retainedPlayer.id];
  const duplicatedSelections = structuredClone(retainedIdsByTeam);
  assert.throws(() => buildTeamsAfterRetention({
    mode: "Mega Auction",
    sampleHistory,
    userTeam: "CSK",
    retainedIdsByTeam
  }), /cannot retain ineligible player/);
  assert.deepEqual(sampleHistory, originalHistory);
  assert.deepEqual(retainedIdsByTeam, duplicatedSelections);

  retainedIdsByTeam.MI = [];
  retainedIdsByTeam.CSK = sampleHistory.CSK.slice(0, 4).map((player) => player.id);
  const overLimitSelections = structuredClone(retainedIdsByTeam);
  assert.throws(() => buildTeamsAfterRetention({
    mode: "Mega Auction",
    sampleHistory,
    userTeam: "CSK",
    retainedIdsByTeam
  }), /retention limit/);
  assert.deepEqual(sampleHistory, originalHistory);
  assert.deepEqual(retainedIdsByTeam, overLimitSelections);
});

test("custom auction retention caps and configured cost schedules are saved with the engine", () => {
  const sampleHistory = createSampleHistory(PLAYERS);
  const retainedIdsByTeam = Object.fromEntries(FRANCHISES.map(({ code }) => [code, []]));
  retainedIdsByTeam.CSK = sampleHistory.CSK.slice(0, 4).map((player) => player.id);
  const prepared = buildTeamsAfterRetention({
    mode: "Custom Auction",
    customRetentionLimit: 4,
    sampleHistory,
    userTeam: "CSK",
    retainedIdsByTeam
  });
  assert.equal(prepared.teams.CSK.retention.configuredLimit, 4);
  assert.equal(prepared.teams.CSK.retention.totalCost, retentionCost("Custom Auction", 4, 4));
  assert.equal(retentionLimit("Custom Auction", 5), 5);
  assert.throws(() => retentionLimit("Custom Auction", 6), /between 0 and 5/);
  const engine = new AuctionEngine({
    players: PLAYERS,
    eligiblePlayers: [],
    userTeam: "CSK",
    mode: "Custom Auction",
    customRetentionLimit: 4,
    startingTeams: prepared.teams
  });
  const resumed = new AuctionEngine({
    players: PLAYERS,
    eligiblePlayers: [],
    userTeam: "CSK",
    mode: "Custom Auction",
    customRetentionLimit: 4,
    snapshot: engine.snapshot()
  });
  assert.equal(resumed.customRetentionLimit, 4);
  assert.equal(resumed.teams.CSK.retention.slotsUsed, 4);
  assert.equal(resumed.teams.CSK.retention.totalCost, retentionCost("Custom Auction", 4, 4));
});

test("AI franchise plans contain affordable eligible primary and backup targets and adapt when a target is lost", () => {
  const engine = engineFor();
  const initialPlan = engine.getAIStrategyPlan("RCB");
  assert.ok(initialPlan);
  assert.equal(initialPlan.franchiseId, "RCB");
  const bowlerPlan = initialPlan.roles.bowler;
  assert.ok(bowlerPlan.required > 0);
  assert.ok(bowlerPlan.targets.length > 1);
  for (const target of bowlerPlan.targets) {
    assert.ok(engine.queue.some((player) => player.id === target.playerId));
    assert.equal(engine.retainedIds.has(target.playerId), false);
    assert.ok(Number.isInteger(target.maximumBid));
    assert.ok(target.maximumBid >= PLAYERS.find((player) => player.id === target.playerId).basePrice);
  }
  const primaryId = bowlerPlan.targets[0].playerId;
  const backupId = bowlerPlan.targets[1].playerId;
  engine.finalized.add(primaryId);
  const refreshedPlan = engine.refreshAIStrategyPlans().get("RCB");
  assert.notEqual(refreshedPlan.roles.bowler.targets[0]?.playerId, primaryId);
  assert.ok(refreshedPlan.roles.bowler.targets.some((target) => target.playerId === backupId));
});

test("auction categories remain ordered and lot numbers are unique and saved", () => {
  const players = [
    { ...PLAYERS.find((player) => player.name === "Virat Kohli"), id: "marquee-1", category: "Marquee batter" },
    { ...PLAYERS.find((player) => player.name === "Rohit Sharma"), id: "batter-1", category: "Grade A" },
    { ...PLAYERS.find((player) => player.name === "Hardik Pandya"), id: "allrounder-1", category: "Grade B" },
    { ...(PLAYERS.find((player) => player.name === "MS Dhoni") ?? PLAYERS.find((player) => player.role === "wicketkeeper")), id: "keeper-1", role: "wicketkeeper", category: "Grade A" },
    { ...PLAYERS.find((player) => player.name === "Jasprit Bumrah"), id: "bowler-1", category: "Grade A" },
    { ...PLAYERS.find((player) => player.name === "Joe Root"), id: "uncapped-1", category: "Uncapped Domestic" },
    { ...PLAYERS.find((player) => player.name === "Rishabh Pant"), id: "unknown-1", role: "unknown", category: "Grade C" }
  ];
  const engine = engineFor({ players, eligiblePlayers: players });
  const numbers = engine.queue.map((player) => player.lotNumber);
  assert.deepEqual(numbers, numbers.map((_number, index) => index + 1));
  assert.equal(new Set(numbers).size, engine.queue.length);
  assert.deepEqual([...new Set(engine.queue.map((player) => player.auctionCategory))], [
    "Marquee Players", "Batters", "All-rounders", "Wicketkeepers", "Bowlers", "Uncapped Players", "Other Players"
  ]);
  engine.startLot();
  engine.startLot();
  const saved = engine.snapshot();
  const resumed = engineFor({ players, eligiblePlayers: players, snapshot: saved });
  assert.deepEqual(resumed.queue.map((player) => player.lotNumber), numbers);
  assert.equal(resumed.currentPlayer.lotNumber, engine.currentPlayer.lotNumber);
});

test("auction opening speech and player introduction complete before bidding", () => {
  const players = [PLAYERS[0], PLAYERS[1]].map((player) => ({ ...player, role: "batter", category: "Grade A" }));
  const engine = engineFor({ players, eligiblePlayers: players });
  const teamNames = Object.fromEntries(FRANCHISES.map((team) => [team.code, team.name]));
  const spoken = [];
  let finishSpeech;
  const director = new AuctioneerDirector({
    speak: (line, done) => {
      spoken.push(line);
      finishSpeech = done;
    },
    onComplete: (event) => {
      if (event.type === "auction-opening") engine.completeAuctionOpening();
      else if (event.type === "category-start" || event.type === "category-transition") engine.startLot();
      else if (event.type === "player-presented") engine.openBidding(event.lotId);
    }
  });
  engine.subscribe((event) => director.handle(event, teamNames));
  engine.startAuction();
  assert.match(spoken[0], /Welcome to the IPL Mega Auction/);
  assert.equal(engine.state, GAME_STATES.READY);
  assert.equal(engine.canBid("MI"), false);
  finishSpeech();
  assert.match(spoken[1], /Welcome to the Batters category/);
  assert.equal(engine.state, GAME_STATES.READY);
  finishSpeech();
  assert.match(spoken[2], new RegExp(engine.currentPlayer.name));
  assert.match(spoken[2], /Lot 001/);
  assert.equal(engine.state, GAME_STATES.INTRODUCING);
  assert.equal(engine.bid("MI"), false);
  finishSpeech();
  assert.equal(engine.state, GAME_STATES.BIDDING_OPEN);
  assert.equal(engine.canBid("MI"), true);
});

test("legacy RTM saves resume as ordinary bidding and ignore legacy RTM state", () => {
  const player = PLAYERS[0];
  const engine = engineFor({ players: [player], eligiblePlayers: [player] });
  startBidding(engine);
  assert.equal(engine.bid("MI"), true);
  const legacySave = {
    ...engine.snapshot(),
    version: 1,
    state: "RTM_PENDING",
    rtmRights: { CSK: 1 },
    pendingRTM: { playerId: player.id, amount: engine.currentBid }
  };
  delete legacySave.queueLotNumbers;
  delete legacySave.announcedCategories;
  const resumed = engineFor({ players: [player], eligiblePlayers: [player], snapshot: legacySave });
  assert.equal(resumed.state, GAME_STATES.GOING_TWICE);
  assert.equal(resumed.currentBid, engine.currentBid);
  assert.equal(resumed.leadingTeam, "MI");
  assert.equal("pendingRTM" in resumed.snapshot(), false);
  assert.equal("rtmRights" in resumed.snapshot(), false);
  assert.equal(resumed.closeLot(), true);
  assert.equal(resumed.teams.MI.purse, CUSTOM_RULES.purse - engine.currentBid);
  assert.equal(resumed.teams.MI.squad.filter((item) => item.id === player.id).length, 1);
});

test("legacy saved queues skip players that are already retained", () => {
  const retainedPlayer = PLAYERS.find((player) => player.season2026FranchiseCode === "CSK");
  const startingTeams = createFranchiseState();
  startingTeams.CSK.purse -= 1800;
  startingTeams.CSK.squad.push({
    ...retainedPlayer,
    purchasePrice: 1800,
    purchaseOrder: 1,
    retained: true,
    currentOwner: "CSK",
    auctionStatus: "RETAINED"
  });
  startingTeams.CSK.history.push({ playerId: retainedPlayer.id, amount: 1800, result: "retained" });
  for (const team of FRANCHISES) delete startingTeams[team.code].retention;
  const legacyEngine = engineFor({ players: PLAYERS, eligiblePlayers: PLAYERS });
  const retainedQueueIndex = legacyEngine.queue.findIndex((player) => player.id === retainedPlayer.id);
  const legacySave = {
    ...legacyEngine.snapshot(),
    version: 1,
    teams: startingTeams,
    index: retainedQueueIndex
  };
  delete legacySave.queueLotNumbers;
  delete legacySave.announcedCategories;
  const resumed = engineFor({ players: PLAYERS, eligiblePlayers: PLAYERS, snapshot: legacySave });
  assert.ok(!resumed.queue.some((player) => player.id === retainedPlayer.id));
  assert.equal(new Set(resumed.queue.map((player) => player.lotNumber)).size, resumed.queue.length);
  assert.equal(resumed.currentPlayer.id, legacyEngine.queue[retainedQueueIndex + 1].id);
  assert.equal(resumed.startLot().id, legacyEngine.queue[retainedQueueIndex + 1].id);
});

test("category transitions announce only populated categories and keep the next lot ready", () => {
  const players = [
    { ...PLAYERS[0], id: "category-marquee", category: "Marquee batter", role: "batter" },
    { ...PLAYERS[1], id: "category-other", category: "Grade C", role: "unknown" }
  ];
  const engine = engineFor({ players, eligiblePlayers: players });
  const events = [];
  engine.subscribe((event) => events.push(event));
  engine.startLot();
  engine.startLot();
  assert.equal(engine.state, GAME_STATES.INTRODUCING);
  engine.openBidding(`${engine.index}:${engine.currentPlayer.id}`);
  engine.closeLot();
  engine.nextLot();
  assert.equal(engine.state, GAME_STATES.READY);
  assert.deepEqual(events.filter((event) => event.type === "category-transition").map((event) => event.nextCategory), ["Other Players"]);
  assert.equal(engine.startLot().id, "category-other");
  assert.equal(engine.state, GAME_STATES.INTRODUCING);
});

test("auctioneer commentary reflects actual accepted bids and sale results", () => {
  const teamNames = Object.fromEntries(FRANCHISES.map((team) => [team.code, team.name]));
  const player = { ...PLAYERS[0], basePrice: 50 };
  const engine = engineFor({ players: [player], eligiblePlayers: [player] });
  const events = [];
  engine.subscribe((event) => {
    if (event.type === "bid") events.push(event);
  });
  startBidding(engine);
  assert.equal(engine.bid("MI"), true);
  assert.equal(engine.bid("SRH"), true);
  assert.equal(engine.bid("CSK"), true);
  assert.equal(engine.bid("SRH"), true);
  const lines = events.map((event) => commentaryFor(event, teamNames));
  assert.deepEqual(lines, [
    "Mumbai Indians open the bidding at fifty lakh rupees!",
    "Sunrisers Hyderabad enter the bidding at seventy-five lakh rupees!",
    "Chennai Super Kings enter the bidding at one crore rupees!",
    "Sunrisers Hyderabad return with a bid of one crore twenty-five lakh rupees!"
  ]);
  assert.equal(commentaryFor({ type: "bid", teamCode: "CSK", amount: 200, previousBid: 175, previousTeamCode: "CSK" }, teamNames), "Chennai Super Kings raise the bid to two crore rupees!");
  assert.equal(commentaryFor({ type: "going-once", teamCode: "RCB", amount: 300 }, teamNames), "Going once at three crore rupees!");
  assert.equal(commentaryFor({ type: "going-twice", teamCode: "RCB", amount: 300 }, teamNames), "Going twice at three crore rupees! Any final bids?");
  assert.match(commentaryFor({ type: "final-call", player: PLAYERS[0], teamCode: "RCB", amount: 300 }, teamNames), /Final call!.*Last chance to bid/);
  assert.equal(commentaryFor({ type: "sold", player: PLAYERS[0], teamCode: "RCB", amount: 300 }, teamNames), "Sold! Virat Kohli goes to Royal Challengers Bengaluru for three crore rupees!");
  assert.equal(commentaryFor({ type: "unsold", player: PLAYERS[0] }, teamNames), "No bids received. Virat Kohli remains unsold at the base price.");
  assert.match(commentaryFor({ type: "player-presented", player: PLAYERS[0], basePrice: 200 }, teamNames), /Next up for auction is Virat Kohli\. An Indian batter\..*two crore rupees.*Who will open the bidding\?/);
  assert.match(commentaryFor({
    type: "player-presented",
    player: { ...PLAYERS[0], capped: false, cappedStatus: "verified", careerHighlight: "A verified highlight.", careerHighlightStatus: "verified" },
    basePrice: 200
  }, teamNames), /An uncapped Indian batter\. A verified highlight\./);
});

test("auctioneer coalesces obsolete bids and recovers when voice synthesis fails", () => {
  const teamNames = Object.fromEntries(FRANCHISES.map((team) => [team.code, team.name]));
  const spoken = [];
  let finishSpeech;
  const director = new AuctioneerDirector({
    speak: (line, done) => { spoken.push(line); finishSpeech = done; },
    onSubtitle: () => {},
    cancelSpeech: () => finishSpeech?.()
  });
  const base = { player: PLAYERS[0] };
  director.handle({ ...base, type: "player-presented", lotId: "lot-1", timestamp: 1, basePrice: 200 }, teamNames);
  finishSpeech();
  director.handle({ ...base, type: "bid", lotId: "lot-1", timestamp: 2, teamCode: "MI", amount: 200, previousBid: 0 }, teamNames);
  director.handle({ ...base, type: "bid", lotId: "lot-1", timestamp: 3, teamCode: "CSK", amount: 225, previousBid: 200, previousTeamCode: "MI", bidderHasBid: false }, teamNames);
  assert.ok(spoken.some((line) => line.includes("Chennai Super Kings")));
  assert.ok(!director.queue.some((item) => item.line.includes("Mumbai Indians open")));
  const failing = new AuctioneerDirector({ speak: () => { throw new Error("speech unavailable"); } });
  failing.handle({ ...base, type: "bid", lotId: "lot-1", timestamp: 4, teamCode: "MI", amount: 250, previousBid: 225 }, teamNames);
  assert.equal(failing.speaking, false);
  assert.equal(failing.queue.length, 0);
});

test("auctioneer completion gates introduction and ignores speech events from an older lot", () => {
  const players = [PLAYERS[0], PLAYERS[1]].map((player) => ({ ...player, role: "batter", category: "Grade A" }));
  const engine = engineFor({ players, eligiblePlayers: players });
  const teamNames = Object.fromEntries(FRANCHISES.map((team) => [team.code, team.name]));
  let finishSpeech;
  const spoken = [];
  const director = new AuctioneerDirector({
    speak: (line, done) => { spoken.push(line); finishSpeech = done; },
    onComplete: (event) => {
      if (event.type === "player-presented") engine.openBidding(event.lotId);
      if (["sold", "unsold", "skipped"].includes(event.type)) engine.nextLot();
      if (event.type === "category-start" || event.type === "category-transition") engine.startLot();
    }
  });
  engine.subscribe((event) => director.handle(event, teamNames));
  engine.startLot();
  finishSpeech();
  const first = engine.currentPlayer;
  assert.equal(engine.state, GAME_STATES.INTRODUCING);
  assert.equal(engine.canBid("MI"), false);
  finishSpeech();
  assert.equal(engine.state, GAME_STATES.BIDDING_OPEN);
  const firstLotId = `${engine.index}:${first.id}`;
  assert.equal(engine.bid("MI"), true);
  assert.equal(engine.closeLot(), true);
  assert.equal(engine.state, GAME_STATES.SOLD);
  finishSpeech();
  assert.equal(engine.index, 1);
  assert.equal(engine.state, GAME_STATES.INTRODUCING);
  const countBeforeStale = spoken.length;
  director.handle({
    id: "stale-bid-event",
    lotId: firstLotId,
    type: "bid",
    player: first,
    teamCode: "CSK",
    amount: 250,
    previousBid: 200
  }, teamNames);
  assert.equal(spoken.length, countBeforeStale);
  assert.match(spoken.at(-1), new RegExp(PLAYERS[1].name));
});

test("starting a new game invalidates callbacks from cancelled speech", () => {
  const teamNames = Object.fromEntries(FRANCHISES.map((team) => [team.code, team.name]));
  const finishCallbacks = [];
  const spoken = [];
  const director = new AuctioneerDirector({
    speak: (line, done) => { spoken.push(line); finishCallbacks.push(done); },
    cancelSpeech: () => {}
  });
  director.handle({ player: PLAYERS[0], type: "player-presented", timestamp: 1, basePrice: 200 }, teamNames);
  director.clear();
  director.handle({ player: PLAYERS[1], type: "player-presented", timestamp: 2, basePrice: 200 }, teamNames);
  const spokenCount = spoken.length;
  finishCallbacks[0]?.();
  assert.equal(spoken.length, spokenCount);
  assert.match(spoken.at(-1), new RegExp(PLAYERS[1].name));
});

test("auction pacing delays are monotonic and reset cancels stale callbacks", () => {
  const queue = new Map();
  let nextHandle = 1;
  const timers = {
    setTimeout(callback, delay) { const id = nextHandle++; queue.set(id, { callback, delay }); return id; },
    clearTimeout(id) { queue.delete(id); }
  };
  const clock = new AuctionClock({ pacing: "Relaxed", timers });
  let fired = false;
  clock.schedule(() => { fired = true; }, clock.delay("openWindow"));
  assert.equal(clock.delay("aiDelay"), 1200);
  assert.ok(clock.delay("openWindow") > clock.delay("goingOnce"));
  assert.ok(clock.delay("resultWindow") > 0);
  clock.reset();
  for (const timer of queue.values()) timer.callback();
  assert.equal(fired, false);
});
