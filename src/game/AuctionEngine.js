import { CUSTOM_RULES, createFranchiseState, FRANCHISES } from "../data/franchises.js";
import { aiBidDecision, buildTeamStrategyPlan, evaluatePlayerValue, legalMaximumBid } from "./PlayerValuation.js";
import { isRetentionCandidateFor, retentionCosts, retentionLimit } from "./RetentionRules.js";
import { validateUserTargetPlan } from "./UserTargetPlan.js";

export const GAME_STATES = Object.freeze({
  READY: "READY",
  INTRODUCING: "INTRODUCING",
  BIDDING_OPEN: "BIDDING_OPEN",
  GOING_ONCE: "GOING_ONCE",
  GOING_TWICE: "GOING_TWICE",
  FINAL_CALL: "FINAL_CALL",
  RTM_PENDING: "RTM_PENDING",
  SOLD: "SOLD",
  UNSOLD: "UNSOLD",
  SKIPPED: "SKIPPED",
  COMPLETE: "COMPLETE"
});

const AUCTION_CATEGORY_ORDER = [
  "Marquee Players", "Batters", "All-rounders", "Wicketkeepers", "Bowlers",
  "Uncapped Players", "Other Players"
];
let auctionEngineSequence = 0;

function auctionCategory(player) {
  if (player.category?.startsWith("Marquee ")) return "Marquee Players";
  if (player.category === "Uncapped Domestic") return "Uncapped Players";
  if (player.role === "batter") return "Batters";
  if (player.role === "allrounder") return "All-rounders";
  if (player.role === "wicketkeeper") return "Wicketkeepers";
  if (player.role === "bowler") return "Bowlers";
  return "Other Players";
}

export function isEligibleForAuction(player, gameState = {}) {
  if (!player?.id || !Number.isInteger(player.basePrice) || player.retained === true || player.currentOwner != null) return false;
  if (["RETAINED", "SOLD", "UNSOLD"].includes(player.auctionStatus)) return false;
  if (gameState.retainedIds?.has(player.id) || gameState.soldPlayerIds?.has(player.id) ||
      gameState.finalized?.has(player.id)) return false;
  return !Object.values(gameState.teams ?? {}).some((team) =>
    team.squad?.some((squadPlayer) => squadPlayer.id === player.id)
  );
}

export function createSeededRandom(seed) {
  let value = (Number(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(array, random = Math.random) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createAuctionOrder(players, { randomized = true, seed = Date.now() } = {}) {
  const random = createSeededRandom(seed);
  const unique = [...new Map(players
    .filter((player) => isEligibleForAuction(player))
    .map((player) => [player.id, player])).values()];
  const categories = new Map(AUCTION_CATEGORY_ORDER.map((category) => [category, []]));
  for (const player of unique) categories.get(auctionCategory(player)).push(player);
  const ordered = AUCTION_CATEGORY_ORDER.flatMap((category) => {
    const group = categories.get(category);
    return randomized ? shuffle(group, random) : group;
  });
  return ordered.map((player, index) => ({
    ...player,
    auctionCategory: auctionCategory(player),
    auctionSetNumber: AUCTION_CATEGORY_ORDER.indexOf(auctionCategory(player)) + 1,
    auctionSetName: auctionCategory(player),
    auctionCatalogueStatus: "custom simulation order; no verified official set order",
    lotNumber: index + 1,
    queuePosition: index + 1,
    auctionStatus: "AVAILABLE_FOR_AUCTION",
    currentOwner: null
  }));
}

export function nextBidAmount(currentBid, basePrice) {
  if (currentBid === 0) return basePrice;
  return currentBid + (currentBid < 500 ? 25 : currentBid < 2000 ? 50 : currentBid < 5000 ? 100 : 200);
}

export class AuctionEngine {
  constructor({ players, eligiblePlayers = players, userTeam = "CSK", mode = "Mega Auction", auctionSeason = 2026, difficulty = "Normal", randomized = true, seed = Date.now(), snapshot = null, startingTeams = null, pacing = "Relaxed", userTargetPlan = [], customRetentionLimit = CUSTOM_RULES.megaRetentionLimit, rtmEnabled = CUSTOM_RULES.rtmEnabled, rtmLimit = CUSTOM_RULES.rtmLimitPerFranchise }) {
    this.players = players;
    this.engineSessionId = ++auctionEngineSequence;
    this.userTeam = snapshot?.userTeam ?? userTeam;
    this.mode = snapshot?.mode ?? mode;
    this.auctionSeason = snapshot?.auctionSeason ?? auctionSeason;
    if (![2025, 2026].includes(this.auctionSeason)) throw new Error("Auction season must be 2025 or 2026.");
    this.customRetentionLimit = snapshot?.customRetentionLimit ?? customRetentionLimit;
    this.rtmEnabled = (snapshot?.rtmEnabled ?? rtmEnabled) === true;
    rtmLimit = snapshot?.rtmLimit ?? rtmLimit;
    if (!Number.isInteger(rtmLimit) || rtmLimit < 0) throw new Error("RTM limit must be a non-negative integer.");
    this.rtmLimit = rtmLimit;
    this.difficulty = snapshot?.difficulty ?? difficulty;
    this.pacing = snapshot?.pacing ?? pacing;
    this.seed = snapshot?.seed ?? seed;
    this.teams = startingTeams ? structuredClone(startingTeams) : createFranchiseState();
    this.normalizeRetentionState();
    this.userTargetPlan = validateUserTargetPlan(userTargetPlan, this.players, { retainedIds: this.retainedIds });
    this.queue = createAuctionOrder(
      eligiblePlayers.filter((player) => isEligibleForAuction(player, {
        retainedIds: this.retainedIds,
        soldPlayerIds: this.soldPlayerIds ?? new Set(),
        teams: this.teams
      })),
      { randomized, seed }
    );
    const releasedByPlayer = new Map(FRANCHISES.flatMap(({ code }) =>
      (this.teams[code]?.retention?.releasedPlayers ?? [])
        .map((release) => [release.playerId, code])
    ));
    this.queue = this.queue.map((player) => ({
      ...player,
      ...(releasedByPlayer.has(player.id) ? { releasedBy: releasedByPlayer.get(player.id) } : {}),
      ...(releasedByPlayer.has(player.id) && verifiedPreviousOwner(player, this.auctionSeason) === releasedByPlayer.get(player.id)
        ? { rtmEligible: true, rtmOwner: releasedByPlayer.get(player.id) }
        : { rtmEligible: false, rtmOwner: null })
    }));
    this.eligiblePlayerIds = new Set(eligiblePlayers
      .filter((player) => Number.isInteger(player.basePrice))
      .map((player) => player.id));
    this.index = 0;
    this.state = GAME_STATES.READY;
    this.openingComplete = false;
    this.openingPending = false;
    this.isPaused = false;
    this.currentBid = 0;
    this.leadingTeam = null;
    this.withdrawn = new Set();
    this.skipped = new Set();
    this.history = [];
    this.soldPlayerIds = new Set();
    this.listeners = new Set();
    this.eventSequence = 0;
    this.sessionSequence = 0;
    this.activeSessionId = null;
    this.lastResultSessionId = null;
    this.finalCallRemainingMs = null;
    this.finalized = new Set();
    this.rtmUsedByTeam = Object.fromEntries(FRANCHISES.map(({ code }) => [code, 0]));
    this.pendingRTM = null;
    this.aiDecisions = new Map();
    this.aiDecisionHistory = [];
    this.aiStrategyPlans = new Map();
    this.announcedCategories = new Set();
    if (snapshot) this.restore(snapshot);
    this.refreshAIStrategyPlans();
  }

  get currentPlayer() { return this.queue[this.index] ?? null; }

  getCurrentLotId(player = this.currentPlayer) {
    return player ? `${this.index}:${player.id}` : null;
  }

  isCurrentSession(sessionId) {
    return sessionId != null && sessionId === this.activeSessionId;
  }

  setFinalCallRemaining(milliseconds) {
    this.finalCallRemainingMs = Number.isFinite(milliseconds) && milliseconds >= 0
      ? milliseconds
      : null;
  }

  isCurrentLot(lotId = this.getCurrentLotId()) {
    if (lotId == null) return true;
    const currentLotId = this.getCurrentLotId();
    return currentLotId !== null && currentLotId === lotId;
  }

  get completedCount() {
    return this.finalized.size;
  }
  get retainedIds() {
    return new Set(FRANCHISES.flatMap(({ code }) => {
      const team = this.teams[code];
      return [
        ...(team?.retention?.retainedPlayerIds ?? []),
        ...(team?.squad ?? [])
          .filter((player) => player.retained === true || player.auctionStatus === "RETAINED")
          .map((player) => player.id)
      ];
    }));
  }

  normalizeRetentionState() {
    const franchiseByRetainedPlayer = new Map();
    for (const { code } of FRANCHISES) {
      const team = this.teams[code];
      const retainedPlayers = (team.squad ?? [])
        .filter((player) => player.retained === true || player.auctionStatus === "RETAINED")
        .sort((a, b) => (a.purchaseOrder ?? 0) - (b.purchaseOrder ?? 0))
        .map((player, index) => ({
          id: player.id,
          name: player.name,
          slot: index + 1,
          cost: player.retentionCost ?? player.purchasePrice
        }));
      for (const retained of retainedPlayers) {
        const player = (team.squad ?? []).find((candidate) => candidate.id === retained.id);
        if (!isRetentionCandidateFor(player, code, this.auctionSeason)) {
          throw new Error(`${player.name} is not eligible for retention by ${code}.`);
        }
        if (retainedPlayers.length > retentionLimit(this.mode, this.customRetentionLimit) ||
            retained.cost !== retentionCosts(this.mode, this.customRetentionLimit)[retained.slot - 1] ||
            player.currentOwner !== code || player.auctionStatus !== "RETAINED" ||
            player.purchasePrice !== 0) {
          throw new Error(`Saved retention details for ${player.name} are invalid.`);
        }
        if (franchiseByRetainedPlayer.has(retained.id)) {
          throw new Error(`${player.name} cannot be retained by more than one franchise.`);
        }
        franchiseByRetainedPlayer.set(retained.id, code);
      }
      const totalCost = retainedPlayers.reduce((total, player) => total + (player.cost ?? 0), 0);
      team.retention = {
        ...team.retention,
        franchiseId: code,
        retainedPlayers,
        retainedPlayerIds: retainedPlayers.map((player) => player.id),
        retainedPlayerNames: retainedPlayers.map((player) => player.name),
        slotsUsed: retainedPlayers.length,
        totalCost,
        remainingPurse: CUSTOM_RULES.purse - totalCost,
        configuredLimit: retentionLimit(this.mode, this.customRetentionLimit),
        finalSquadPlayerIds: (team.squad ?? []).map((player) => player.id),
        releasedPlayerIds: team.retention?.releasedPlayerIds ?? [],
        releasedPlayers: team.retention?.releasedPlayers ?? [],
        pricingMethod: team.retention?.pricingMethod ?? "configured custom simulation slot costs"
      };
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, detail = {}) {
    const event = {
      id: `${this.index}:${this.currentPlayer?.id ?? "none"}:${++this.eventSequence}`,
      lotId: this.currentPlayer ? `${this.index}:${this.currentPlayer.id}` : null,
      type,
      timestamp: Date.now(),
      sessionId: this.activeSessionId,
      player: this.currentPlayer,
      lotNumber: this.currentPlayer?.lotNumber,
      auctionCategory: this.currentPlayer?.auctionCategory,
      ...detail
    };
    for (const listener of this.listeners) listener(event, this);
    return event;
  }

  startAuction() {
    if (this.state !== GAME_STATES.READY || this.openingPending) return null;
    if (this.openingComplete) return this.startLot();
    this.openingPending = true;
    this.emit("auction-opening", { mode: this.mode });
    return null;
  }

  completeAuctionOpening() {
    if (!this.openingPending || this.state !== GAME_STATES.READY) return false;
    this.openingPending = false;
    this.openingComplete = true;
    this.startLot();
    return true;
  }

  pause() {
    if (this.isPaused || !this.currentPlayer ||
        ![GAME_STATES.INTRODUCING, GAME_STATES.BIDDING_OPEN, GAME_STATES.GOING_ONCE,
          GAME_STATES.GOING_TWICE, GAME_STATES.FINAL_CALL, GAME_STATES.SOLD,
          GAME_STATES.UNSOLD, GAME_STATES.SKIPPED, GAME_STATES.RTM_PENDING].includes(this.state)) return false;
    this.isPaused = true;
    this.emit("paused");
    return true;
  }

  resume() {
    if (!this.isPaused) return false;
    this.isPaused = false;
    this.emit("resumed");
    return true;
  }

  startLot() {
    if (this.state !== GAME_STATES.READY || this.openingPending) return null;
    while (this.index < this.queue.length && !this.isPlayerAvailable(this.queue[this.index])) {
      this.index += 1;
    }
    if (this.index >= this.queue.length) {
      this.activeSessionId = null;
      this.state = GAME_STATES.COMPLETE;
      this.emit("complete");
      return null;
    }
    this.activeSessionId = `${this.engineSessionId}:${this.index}:${this.currentPlayer.id}:${++this.sessionSequence}`;
    const category = this.queue[this.index].auctionCategory;
    if (!this.announcedCategories.has(category)) {
      this.announcedCategories.add(category);
      this.emit("category-start", {
        category,
        setNumber: this.currentPlayer.auctionSetNumber,
        setName: this.currentPlayer.auctionSetName,
        catalogueStatus: this.currentPlayer.auctionCatalogueStatus
      });
      return this.currentPlayer;
    }
    this.currentBid = 0;
    this.leadingTeam = null;
    this.withdrawn = new Set();
    this.skipped = new Set();
    this.state = GAME_STATES.INTRODUCING;
    this.emit("player-presented", {
      basePrice: this.currentPlayer.basePrice,
      lotNumber: this.currentPlayer.lotNumber,
      auctionCategory: this.currentPlayer.auctionCategory
    });
    return this.currentPlayer;
  }

  isPlayerAvailable(player) {
    return Boolean(player &&
      player.auctionStatus === "AVAILABLE_FOR_AUCTION" &&
      isEligibleForAuction(player, {
        retainedIds: this.retainedIds,
        soldPlayerIds: this.soldPlayerIds,
        finalized: this.finalized,
        teams: this.teams
      }));
  }

  openBidding(lotId, sessionId = this.activeSessionId) {
    if (this.state !== GAME_STATES.INTRODUCING || !this.currentPlayer ||
        !this.isPlayerAvailable(this.currentPlayer) ||
        !this.isCurrentSession(sessionId) ||
        lotId !== `${this.index}:${this.currentPlayer.id}`) return false;
    this.state = GAME_STATES.BIDDING_OPEN;
    this.emit("bidding-open");
    return true;
  }

  replayPresentation() {
    if (this.state !== GAME_STATES.INTRODUCING || !this.currentPlayer) return false;
    this.emit("player-presented", {
      basePrice: this.currentPlayer.basePrice,
      lotNumber: this.currentPlayer.lotNumber,
      auctionCategory: this.currentPlayer.auctionCategory
    });
    return true;
  }

  getNextBid(teamCode) {
    const player = this.currentPlayer;
    const team = this.teams[teamCode];
    if (!player || !team) return null;
    return nextBidAmount(this.currentBid, player.basePrice);
  }

  canBid(teamCode) {
    const player = this.currentPlayer;
    const team = this.teams[teamCode];
    const biddingIsOpen = [GAME_STATES.BIDDING_OPEN, GAME_STATES.GOING_ONCE, GAME_STATES.GOING_TWICE, GAME_STATES.FINAL_CALL].includes(this.state);
    if (this.isPaused || !player || !this.isPlayerAvailable(player) || !team || !biddingIsOpen ||
        this.leadingTeam === teamCode || this.withdrawn.has(teamCode) || this.skipped.has(teamCode)) return false;
    const next = this.getNextBid(teamCode);
    const affordable = legalMaximumBid(team, player, CUSTOM_RULES);
    return next !== null && next <= affordable;
  }

  bid(teamCode, lotId = this.getCurrentLotId(), sessionId = this.activeSessionId) {
    if (!this.isCurrentLot(lotId) || !this.isCurrentSession(sessionId) || !this.canBid(teamCode)) return false;
    const amount = this.getNextBid(teamCode);
    const previousBid = this.currentBid;
    const previousTeamCode = this.leadingTeam;
    const bidderHasBid = this.history.some((item) =>
      item.playerId === this.currentPlayer.id && item.teamCode === teamCode && item.result === "bid"
    );
    this.currentBid = amount;
    this.leadingTeam = teamCode;
    this.state = GAME_STATES.BIDDING_OPEN;
    this.finalCallRemainingMs = null;
    this.history.push({ playerId: this.currentPlayer.id, lotNumber: this.currentPlayer.lotNumber, teamCode, amount, result: "bid" });
    this.emit("bid", { teamCode, amount, previousBid, previousTeamCode, bidderHasBid });
    return true;
  }

  pass(teamCode = this.userTeam, lotId = this.getCurrentLotId()) {
    if (this.isPaused || !this.isCurrentLot(lotId) || !this.isLotActive() || !this.currentPlayer || this.withdrawn.has(teamCode) || this.skipped.has(teamCode)) return false;
    this.withdrawn.add(teamCode);
    this.history.push({ playerId: this.currentPlayer.id, lotNumber: this.currentPlayer.lotNumber, teamCode, result: "pass" });
    this.emit("pass", { teamCode });
    return true;
  }

  skip(teamCode = this.userTeam, lotId = this.getCurrentLotId()) {
    if (this.isPaused || !this.isCurrentLot(lotId) || !this.isLotActive() || !this.currentPlayer) return false;
    const cancelledSessionId = this.activeSessionId;
    this.activeSessionId = null;
    return this.finalizeCurrentPlayer("skipped", { skipReason: "USER_SKIPPED", lotId, cancelledSessionId });
  }

  refreshAIStrategyPlans() {
    const availablePlayers = this.queue.slice(this.index).filter((player) => this.isPlayerAvailable(player));
    this.aiStrategyPlans = new Map(FRANCHISES
      .filter((franchise) => franchise.code !== this.userTeam)
      .map((franchise) => [franchise.code, buildTeamStrategyPlan({
        team: this.teams[franchise.code],
        players: availablePlayers,
        teams: Object.values(this.teams),
        rules: CUSTOM_RULES,
        difficulty: this.difficulty
      })]));
    return this.aiStrategyPlans;
  }

  getAIStrategyPlan(teamCode) {
    return this.aiStrategyPlans.get(teamCode) ?? null;
  }

  aiDecision(teamCode, lotId = this.getCurrentLotId(), sessionId = this.activeSessionId) {
    const player = this.currentPlayer;
    const team = this.teams[teamCode];
    if (!player || !team || teamCode === this.userTeam || !this.isCurrentLot(lotId) ||
      !this.isCurrentSession(sessionId) || !this.isLotActive() ||
        !this.isPlayerAvailable(player)) return false;
    const nextBid = this.getNextBid(teamCode);
    this.refreshAIStrategyPlans();
    const decision = aiBidDecision({
      player,
      team,
      remainingPlayers: this.queue.slice(this.index + 1),
      teams: Object.values(this.teams),
      currentBid: this.currentBid,
      nextBid,
      difficulty: this.difficulty,
      rules: CUSTOM_RULES
    });
    const target = this.aiStrategyPlans.get(teamCode)?.roles[player.role]?.targets
      .find((candidate) => candidate.playerId === player.id);
    decision.targetTier = target?.tier ?? null;
    decision.targetPriorityScore = target?.priorityScore ?? null;
    if (target) decision.reason = `${target.tier} ${player.role} target; ${decision.reason}`;
    if (this.leadingTeam === teamCode || this.withdrawn.has(teamCode) || this.skipped.has(teamCode)) {
      decision.canBid = false;
      decision.reason = this.leadingTeam === teamCode ? "Already leading; cannot bid against itself." : "Withdrawn from this lot.";
    }
    this.aiDecisions.set(teamCode, decision);
    if (!decision.canBid) {
      if (this.leadingTeam !== teamCode && !this.withdrawn.has(teamCode)) {
        this.withdrawn.add(teamCode);
        this.aiDecisionHistory.push({ teamCode, at: Date.now(), playerId: player.id, decision: "withdraw", reason: decision.reason });
      }
      this.emit("ai-decision", { teamCode, decision });
      return false;
    }
    const accepted = this.bid(teamCode, lotId, sessionId);
    if (accepted) this.aiDecisions.set(teamCode, { ...decision, canBid: true, reason: "Accepted the legal next bid." });
    return accepted;
  }

  getAIDecision(teamCode) { return this.aiDecisions.get(teamCode) ?? null; }

  getRoleNeeds(teamCode) {
    const team = this.teams[teamCode];
    if (!team) return {};
    return Object.fromEntries(Object.entries(team.needs ?? {}).map(([role, target]) => [
      role,
      Math.max(0, target - team.squad.filter((player) => player.role === role).length)
    ]));
  }

  getFranchiseDashboard(teamCode) {
    const franchise = FRANCHISES.find((team) => team.code === teamCode);
    const team = this.teams[teamCode];
    if (!franchise || !team) return null;
    const roleCounts = Object.fromEntries(["batter", "wicketkeeper", "allrounder", "bowler"].map((role) => [
      role,
      team.squad.filter((player) => player.role === role).length
    ]));
    const paceCount = team.squad.filter((player) => /fast|pace|medium|seam/i.test(player.bowlingStyle ?? "")).length;
    const spinCount = team.squad.filter((player) => /spin|off break|leg break|orthodox/i.test(player.bowlingStyle ?? "")).length;
    return {
      franchise,
      purse: team.purse,
      squad: team.squad,
      squadSize: team.squad.length,
      remainingSlots: Math.max(0, CUSTOM_RULES.maxSquad - team.squad.length),
      retentionCount: team.retention.slotsUsed,
      retentionLimit: retentionLimit(this.mode, this.customRetentionLimit),
      retentionCost: team.retention.totalCost,
      retainedPlayers: team.squad.filter((player) => player.retained === true),
      releasedPlayers: team.retention.releasedPlayers ?? [],
      purchasedPlayers: team.squad.filter((player) => player.retained !== true),
      roleCounts,
      paceCount,
      spinCount,
      unknownBowlingStyleCount: team.squad.filter((player) =>
        player.role === "bowler" && !player.bowlingStyle
      ).length,
      overseasCount: team.squad.filter((player) => player.isOverseas === true).length,
      unknownOverseasCount: team.squad.filter((player) => player.isOverseas == null).length,
      missingRoles: Object.entries(this.getRoleNeeds(teamCode))
        .filter(([, count]) => count > 0).map(([role, count]) => ({ role, count })),
      seedPlayers: this.players.filter((player) => player.seedFranchiseCodes?.includes(teamCode)),
      verifiedReferenceSquad: this.players.filter((player) =>
        player.season2026AssociationStatus === "verified" &&
        player.season2026FranchiseCode === teamCode
      ),
      strategy: team.strategy,
      personality: team.personality
    };
  }

  getTeamEligibility(teamCode) {
    const team = this.teams[teamCode];
    const player = this.currentPlayer;
    const needs = this.getRoleNeeds(teamCode);
    const canBid = this.canBid(teamCode);
    const overseasCount = team?.squad.filter((item) => item.isOverseas).length ?? 0;
    const reason = !player ? "No active lot" :
      this.leadingTeam === teamCode ? "Currently leading" :
        this.withdrawn.has(teamCode) ? "Passed on this lot" :
          this.skipped.has(teamCode) ? "Skipped this lot" :
            team.squad.length >= CUSTOM_RULES.maxSquad ? "Squad full" :
              player.isOverseas && overseasCount >= CUSTOM_RULES.maxOverseas ? "Overseas limit reached" :
                canBid ? "Eligible" : "Purse reserve / next increment";
    return { canBid, reason, needs };
  }

  isLotActive() {
    return !this.isPaused && [GAME_STATES.BIDDING_OPEN, GAME_STATES.GOING_ONCE, GAME_STATES.GOING_TWICE, GAME_STATES.FINAL_CALL].includes(this.state);
  }

  goingOnce(lotId = this.getCurrentLotId(), sessionId = this.activeSessionId) {
    if (this.isPaused || !this.isCurrentLot(lotId) || !this.isCurrentSession(sessionId) || this.state !== GAME_STATES.BIDDING_OPEN) return false;
    this.state = GAME_STATES.GOING_ONCE;
    this.emit("going-once", { teamCode: this.leadingTeam, amount: this.currentBid });
    return true;
  }

  goingTwice(lotId = this.getCurrentLotId(), sessionId = this.activeSessionId) {
    if (this.isPaused || !this.isCurrentLot(lotId) || !this.isCurrentSession(sessionId) || this.state !== GAME_STATES.GOING_ONCE) return false;
    this.state = GAME_STATES.GOING_TWICE;
    this.emit("going-twice", { teamCode: this.leadingTeam, amount: this.currentBid });
    return true;
  }

  finalCall(lotId = this.getCurrentLotId(), sessionId = this.activeSessionId) {
    if (this.isPaused || !this.isCurrentLot(lotId) || !this.isCurrentSession(sessionId) || this.state !== GAME_STATES.GOING_TWICE) return false;
    this.state = GAME_STATES.FINAL_CALL;
    this.emit("final-call", { teamCode: this.leadingTeam, amount: this.currentBid });
    return true;
  }

  closeLot(lotId = this.getCurrentLotId(), sessionId = this.activeSessionId) {
    const player = this.currentPlayer;
    if (!player || !this.isCurrentLot(lotId) || !this.isCurrentSession(sessionId) ||
        !this.isLotActive() || !this.isPlayerAvailable(player)) return false;
    if (this.leadingTeam) {
      const team = this.teams[this.leadingTeam];
      if (!team || team.purse < this.currentBid || team.squad.some((item) => item.id === player.id)) return false;
      const rtmOwner = player.rtmEligible === true ? player.rtmOwner : null;
      const rtmTeam = rtmOwner && rtmOwner !== this.leadingTeam ? this.teams[rtmOwner] : null;
      if (this.rtmEnabled && rtmTeam && this.rtmUsedByTeam[rtmOwner] < this.rtmLimit &&
          legalMaximumBid(rtmTeam, player, CUSTOM_RULES) >= this.currentBid) {
        this.pendingRTM = {
          playerId: player.id,
          lotId: this.getCurrentLotId(),
          teamCode: rtmOwner,
          bidderTeam: this.leadingTeam,
          amount: this.currentBid,
          sessionId
        };
        this.state = GAME_STATES.RTM_PENDING;
        this.emit("rtm-offered", { teamCode: rtmOwner, bidderTeam: this.leadingTeam, amount: this.currentBid });
        if (rtmOwner !== this.userTeam) {
          const evaluation = evaluatePlayerValue({
            player,
            team: rtmTeam,
            teams: Object.values(this.teams),
            remainingPlayers: this.queue.slice(this.index + 1),
            rules: CUSTOM_RULES
          });
          this.resolveRTM(rtmOwner, evaluation.recommendedBidLimit >= this.currentBid && evaluation.roleNeed > 0);
        }
        return true;
      }
      return this.finalizeCurrentPlayer("sold", { teamCode: this.leadingTeam, amount: this.currentBid, lotId });
    }
    return this.finalizeCurrentPlayer("unsold", { lotId });
  }

  resolveRTM(teamCode, useRTM, lotId = this.getCurrentLotId(), sessionId = this.activeSessionId) {
    const pending = this.pendingRTM;
    if (this.isPaused || this.state !== GAME_STATES.RTM_PENDING || !pending ||
        !this.isCurrentLot(lotId) || !this.isCurrentSession(sessionId) || pending.lotId !== lotId ||
        pending.sessionId !== sessionId || pending.teamCode !== teamCode) return false;
    if (useRTM) {
      const team = this.teams[teamCode];
      if (!team || legalMaximumBid(team, this.currentPlayer, CUSTOM_RULES) < pending.amount ||
          this.rtmUsedByTeam[teamCode] >= this.rtmLimit) return false;
      return this.finalizeCurrentPlayer("sold", {
        teamCode,
        amount: pending.amount,
        lotId,
        allowRTM: true
      });
    }
    return this.finalizeCurrentPlayer("sold", {
      teamCode: pending.bidderTeam,
      amount: pending.amount,
      lotId,
      allowRTM: true
    });
  }

  finalizeCurrentPlayer(result, { teamCode = null, amount = null, skipReason = null, lotId = this.getCurrentLotId(), allowRTM = false, cancelledSessionId = null } = {}) {
    const player = this.currentPlayer;
    const rtmPending = allowRTM && this.state === GAME_STATES.RTM_PENDING && this.pendingRTM?.lotId === lotId;
    if (!player || !this.isCurrentLot(lotId) || this.isPaused || (!this.isLotActive() && !rtmPending) ||
        !this.isPlayerAvailable(player) || this.finalized.has(player.id) ||
        !["sold", "unsold", "skipped"].includes(result)) return false;

    if (result === "sold") {
      const team = this.teams[teamCode];
      if (!team || !Number.isInteger(amount) || amount < player.basePrice ||
          (!rtmPending && this.leadingTeam !== teamCode) ||
          rtmPending && (!allowRTM || ![this.pendingRTM.teamCode, this.pendingRTM.bidderTeam].includes(teamCode)) ||
          this.currentBid !== amount ||
          amount > legalMaximumBid(team, player, CUSTOM_RULES) ||
          team.squad.some((item) => item.id === player.id)) return false;
          const resultSessionId = cancelledSessionId ?? this.activeSessionId;
          this.activeSessionId = null;
          this.lastResultSessionId = resultSessionId;
      const usedRTM = rtmPending && teamCode === this.pendingRTM.teamCode;
        if (usedRTM) this.rtmUsedByTeam[teamCode] += 1;
      team.purse -= amount;
      team.squad.push({
        ...player,
        purchasePrice: amount,
        purchaseOrder: team.squad.length + 1,
        currentOwner: teamCode,
        auctionStatus: "SOLD"
      });
      team.retention.finalSquadPlayerIds = team.squad.map((item) => item.id);
      team.history.push({ playerId: player.id, amount, result: "sold", lotNumber: player.lotNumber, ...(usedRTM ? { rtm: true } : {}) });
      this.history.push({ playerId: player.id, lotNumber: player.lotNumber, teamCode, amount, result: "sold", ...(usedRTM ? { rtm: true } : {}) });
      this.leadingTeam = teamCode;
      this.soldPlayerIds.add(player.id);
      this.state = GAME_STATES.SOLD;
      this.queue[this.index] = { ...player, currentOwner: teamCode, auctionStatus: "SOLD" };
      this.finalized.add(player.id);
      this.pendingRTM = null;
      this.finalCallRemainingMs = null;
      this.refreshAIStrategyPlans();
      this.emit("sold", { teamCode, amount, rtm: usedRTM, lotNumber: player.lotNumber, sessionId: resultSessionId });
      return true;
    }

    if ((result === "unsold" && this.leadingTeam !== null) ||
        (result === "skipped" && skipReason !== "USER_SKIPPED")) return false;
    const resultSessionId = cancelledSessionId ?? this.activeSessionId;
    this.activeSessionId = null;
    this.lastResultSessionId = resultSessionId;
    this.leadingTeam = null;
    this.currentBid = 0;
    this.finalized.add(player.id);
    this.pendingRTM = null;
    this.finalCallRemainingMs = null;
    const auctionStatus = result === "skipped" ? "SKIPPED" : "UNSOLD";
    this.state = result === "skipped" ? GAME_STATES.SKIPPED : GAME_STATES.UNSOLD;
    this.queue[this.index] = { ...player, auctionStatus };
    const historyRecord = {
      playerId: player.id,
      lotNumber: player.lotNumber,
      result,
      ...(skipReason ? { skipReason } : {})
    };
    this.history.push(historyRecord);
    this.refreshAIStrategyPlans();
    this.emit(result, { lotNumber: player.lotNumber, sessionId: resultSessionId, ...(skipReason ? { skipReason } : {}) });
    return true;
  }

  finalizeSale(teamCode, amount) {
    return this.finalizeCurrentPlayer("sold", { teamCode, amount });
  }

  nextLot(sessionId = this.lastResultSessionId) {
    if (this.isPaused || !this.lastResultSessionId || sessionId !== this.lastResultSessionId ||
        ![GAME_STATES.SOLD, GAME_STATES.UNSOLD, GAME_STATES.SKIPPED].includes(this.state)) return false;
    this.lastResultSessionId = null;
    this.finalCallRemainingMs = null;
    const previousCategory = this.currentPlayer?.auctionCategory;
    this.index += 1;
    if (this.index >= this.queue.length) {
      this.currentBid = 0;
      this.leadingTeam = null;
      this.state = GAME_STATES.COMPLETE;
      this.emit("complete");
      return true;
    }
    const nextCategory = this.queue[this.index].auctionCategory;
    if (nextCategory !== previousCategory) {
      this.currentBid = 0;
      this.leadingTeam = null;
      this.state = GAME_STATES.READY;
      this.announcedCategories.add(nextCategory);
      this.emit("category-transition", { previousCategory, nextCategory });
      return true;
    }
    this.state = GAME_STATES.READY;
    this.startLot();
    return true;
  }

  progressFor(teamCode = this.userTeam) {
    const team = this.teams[teamCode];
    return {
      sold: this.soldPlayerIds.size,
      unsold: this.history.filter((item) => item.result === "unsold").length,
      skipped: this.history.filter((item) => item.result === "skipped" && item.skipReason === "USER_SKIPPED").length,
      remaining: Math.max(0, this.queue.length - this.index),
      lot: this.currentPlayer?.lotNumber ?? this.queue.at(-1)?.lotNumber ?? 0,
      lotNumber: this.currentPlayer?.lotNumber ?? null,
      total: this.queue.length,
      purse: team?.purse ?? 0,
      squadSize: team?.squad.length ?? 0
    };
  }

  snapshot() {
    return {
      version: 9, userTeam: this.userTeam, mode: this.mode, auctionSeason: this.auctionSeason, customRetentionLimit: this.customRetentionLimit,
      rtmEnabled: this.rtmEnabled, rtmLimit: this.rtmLimit, rtmUsedByTeam: this.rtmUsedByTeam,
      ...(this.pendingRTM ? { pendingRTM: this.pendingRTM } : {}), difficulty: this.difficulty,
      seed: this.seed, queueIds: this.queue.map((player) => player.id), index: this.index,
      queueLotNumbers: this.queue.map((player) => player.lotNumber),
      state: this.state, currentBid: this.currentBid, leadingTeam: this.leadingTeam,
      withdrawn: [...this.withdrawn], skipped: [...this.skipped], history: this.history,
      soldPlayerIds: [...this.soldPlayerIds], teams: this.teams, finalized: [...this.finalized],
      announcedCategories: [...this.announcedCategories],
      userTargetPlan: this.userTargetPlan,
      openingComplete: this.openingComplete,
      pacing: this.pacing,
      finalCallRemainingMs: this.finalCallRemainingMs,
      isPaused: this.isPaused
    };
  }

  restore(snapshot) {
    const byId = new Map(this.players.map((player) => [player.id, player]));
    if (!snapshot || ![1, 2, 3, 4, 5, 6, 7, 8, 9].includes(snapshot.version) || !Array.isArray(snapshot.queueIds) ||
        snapshot.queueIds.some((id) => !byId.has(id)) ||
        !Array.isArray(snapshot.history) || !Array.isArray(snapshot.soldPlayerIds) ||
        !Array.isArray(snapshot.withdrawn) || !Array.isArray(snapshot.skipped) ||
        !Array.isArray(snapshot.finalized)) {
      throw new Error("Saved auction is invalid or references unknown players.");
    }
    if (new Set(snapshot.queueIds).size !== snapshot.queueIds.length) {
      throw new Error("Saved auction contains duplicate queue entries.");
    }
    if (!FRANCHISES.some((team) => team.code === snapshot.userTeam) || !snapshot.teams || !snapshot.teams[snapshot.userTeam]) {
      throw new Error("Saved auction has invalid franchise data.");
    }
    if (!Number.isInteger(snapshot.index) || snapshot.index < 0 || snapshot.index > snapshot.queueIds.length) {
      throw new Error("Saved auction position is invalid.");
    }
    if (!Object.values(GAME_STATES).includes(snapshot.state) && snapshot.state !== "RTM_PENDING") {
      throw new Error("Saved auction state is malformed.");
    }
    if (!Number.isInteger(snapshot.currentBid) || snapshot.currentBid < 0 ||
        !["Mega Auction", "Mini Auction", "Custom Auction"].includes(snapshot.mode) ||
        snapshot.auctionSeason != null && ![2025, 2026].includes(snapshot.auctionSeason) ||
        snapshot.mode === "Custom Auction" &&
          !Number.isInteger(snapshot.customRetentionLimit ?? CUSTOM_RULES.megaRetentionLimit) ||
        snapshot.mode === "Custom Auction" &&
          (snapshot.customRetentionLimit ?? CUSTOM_RULES.megaRetentionLimit) < 0 ||
        snapshot.mode === "Custom Auction" &&
          (snapshot.customRetentionLimit ?? CUSTOM_RULES.megaRetentionLimit) > CUSTOM_RULES.miniRetentionLimit ||
        !["Easy", "Normal", "Hard"].includes(snapshot.difficulty) ||
        !["Relaxed", "Standard", "Fast"].includes(snapshot.pacing ?? "Relaxed") ||
        (snapshot.leadingTeam !== null && !FRANCHISES.some((team) => team.code === snapshot.leadingTeam))) {
      throw new Error("Saved auction state is malformed.");
    }
    const retainedIds = new Set(FRANCHISES.flatMap((team) => {
      const saved = snapshot.teams[team.code];
      return [
        ...(saved?.retention?.retainedPlayerIds ?? []),
        ...(saved?.squad ?? [])
          .filter((player) => player?.retained === true || player?.auctionStatus === "RETAINED")
          .map((player) => player.id)
      ];
    }));
    const userTargetPlan = validateUserTargetPlan(snapshot.userTargetPlan ?? this.userTargetPlan, this.players, { retainedIds });
    const queueIds = snapshot.queueIds.filter((id) => !retainedIds.has(id));
    const queueLotNumbers = Array.isArray(snapshot.queueLotNumbers) && snapshot.queueLotNumbers.length === snapshot.queueIds.length
      ? snapshot.queueIds.map((id, index) => retainedIds.has(id) ? null : snapshot.queueLotNumbers[index]).filter((number) => number !== null)
      : queueIds.map((_id, index) => index + 1);
    if (queueLotNumbers.length !== queueIds.length ||
        queueLotNumbers.some((number) => !Number.isInteger(number) || number < 1) ||
        new Set(queueLotNumbers).size !== queueLotNumbers.length) {
      throw new Error("Saved auction lot numbers are invalid.");
    }
    if (snapshot.announcedCategories != null &&
        (!Array.isArray(snapshot.announcedCategories) ||
          snapshot.announcedCategories.some((category) => !AUCTION_CATEGORY_ORDER.includes(category)))) {
      throw new Error("Saved auction categories are invalid.");
    }
    const expectedQueueIds = new Set([...this.eligiblePlayerIds].filter((id) => !retainedIds.has(id)));
    if (queueIds.length !== expectedQueueIds.size || queueIds.some((id) => !expectedQueueIds.has(id))) {
      throw new Error("Saved auction is missing eligible players.");
    }
    const oldCurrentId = snapshot.queueIds[snapshot.index];
    const currentWasRetained = retainedIds.has(oldCurrentId);
    if (currentWasRetained && (snapshot.soldPlayerIds.includes(oldCurrentId) || snapshot.finalized.includes(oldCurrentId))) {
      throw new Error(`Retained player ${oldCurrentId} has conflicting saved auction results.`);
    }
    const index = snapshot.queueIds.slice(0, snapshot.index).filter((id) => !retainedIds.has(id)).length;
    const hasRTMPending = snapshot.state === GAME_STATES.RTM_PENDING && snapshot.rtmEnabled === true &&
      snapshot.pendingRTM && snapshot.pendingRTM.playerId === snapshot.queueIds[snapshot.index];
    const state = currentWasRetained ? GAME_STATES.READY :
      snapshot.state === "RTM_PENDING" && !hasRTMPending ? GAME_STATES.GOING_TWICE : snapshot.state;
    const currentBid = currentWasRetained ? 0 : snapshot.currentBid;
    const leadingTeam = currentWasRetained ? null : snapshot.leadingTeam;
    const history = snapshot.history
      .map((item) => item.result === "rtm-used" ? { ...item, result: "sold" } : item)
      .filter((item) => !retainedIds.has(item.playerId));
    const soldPlayerIds = snapshot.soldPlayerIds.filter((id) => !retainedIds.has(id));
    const finalized = snapshot.finalized.filter((id) => !retainedIds.has(id));
    const withdrawn = currentWasRetained ? [] : snapshot.withdrawn;
    const skipped = currentWasRetained ? [] : snapshot.skipped;
    const leaderAllowed = [
      GAME_STATES.BIDDING_OPEN, GAME_STATES.GOING_ONCE, GAME_STATES.GOING_TWICE, GAME_STATES.FINAL_CALL,
      GAME_STATES.RTM_PENDING, GAME_STATES.SOLD, GAME_STATES.COMPLETE
    ].includes(state);
    if ((leadingTeam === null && currentBid !== 0) ||
        (leadingTeam !== null && (currentBid === 0 || !leaderAllowed)) ||
        (state === GAME_STATES.SOLD && leadingTeam === null) ||
        ([GAME_STATES.UNSOLD, GAME_STATES.SKIPPED].includes(state) && leadingTeam !== null) ||
        (state === GAME_STATES.COMPLETE && index !== queueIds.length)) {
      throw new Error("Saved bid leader or auction state is inconsistent.");
    }
    const purchasedIds = new Set();
    const assignedIds = new Set();
    const restoredTeams = createFranchiseState();
    for (const franchise of FRANCHISES) {
      const saved = snapshot.teams[franchise.code];
      if (!saved || !Number.isInteger(saved.purse) || saved.purse < 0 || !Array.isArray(saved.squad)) {
        throw new Error(`Saved data for ${franchise.code} is invalid.`);
      }
      if (saved.squad.length > CUSTOM_RULES.maxSquad ||
          saved.squad.some((player) => !player || !byId.has(player.id) ||
            (player.currentOwner != null && player.currentOwner !== franchise.code) ||
            !Number.isInteger(player.purchasePrice) || player.purchasePrice < 0 ||
            (!(player.retained === true || player.auctionStatus === "RETAINED") &&
              player.purchasePrice < byId.get(player.id).basePrice))) {
        throw new Error(`Saved squad for ${franchise.code} is invalid.`);
      }
      const normalizedSquad = saved.squad.map((item, index) => ({
        ...byId.get(item.id),
        ...(item.lotNumber ? { lotNumber: item.lotNumber } : {}),
        ...(item.auctionCategory ? { auctionCategory: item.auctionCategory } : {}),
        ...(item.auctionSetNumber ? { auctionSetNumber: item.auctionSetNumber } : {}),
        ...(item.auctionSetName ? { auctionSetName: item.auctionSetName } : {}),
        ...(item.auctionCatalogueStatus ? { auctionCatalogueStatus: item.auctionCatalogueStatus } : {}),
        ...(item.queuePosition ? { queuePosition: item.queuePosition } : {}),
        ...(typeof item.rtmEligible === "boolean" ? { rtmEligible: item.rtmEligible } : {}),
        ...(item.rtmOwner !== undefined ? { rtmOwner: item.rtmOwner } : {}),
        purchasePrice: item.retained === true || item.auctionStatus === "RETAINED" ? 0 : item.purchasePrice,
        ...(item.retained === true || item.auctionStatus === "RETAINED"
          ? { retentionCost: item.retentionCost ?? item.purchasePrice }
          : {}),
        purchaseOrder: index + 1,
        ...(item.retained === true || item.auctionStatus === "RETAINED" ? { retained: true } : {}),
        currentOwner: item.currentOwner ?? franchise.code,
        auctionStatus: item.retained === true || item.auctionStatus === "RETAINED" ? "RETAINED" : "SOLD"
      }));
      if (normalizedSquad.filter((player) => player.isOverseas).length > CUSTOM_RULES.maxOverseas) {
        throw new Error(`Saved squad for ${franchise.code} exceeds the overseas-player limit.`);
      }
      for (const player of normalizedSquad) {
        if (assignedIds.has(player.id)) throw new Error(`Player ${player.id} appears in more than one saved squad.`);
        assignedIds.add(player.id);
        if (!player.retained) purchasedIds.add(player.id);
      }
      const spent = normalizedSquad.reduce((total, player) =>
        total + (player.retained ? player.retentionCost : player.purchasePrice), 0);
      if (saved.purse + spent !== CUSTOM_RULES.purse) {
        throw new Error(`Saved purse for ${franchise.code} does not match its purchases.`);
      }
      restoredTeams[franchise.code] = {
        ...restoredTeams[franchise.code],
        purse: saved.purse,
        squad: normalizedSquad,
        ...(saved.retention ? { retention: saved.retention } : {}),
        history: (Array.isArray(saved.history) ? saved.history : normalizedSquad.map((player) => ({
          playerId: player.id,
          amount: player.retained ? player.retentionCost : player.purchasePrice,
          result: player.retained ? "retained" : "sold"
        }))).map((item) => item.result === "rtm-used" ? { ...item, result: "sold" } : item)
      };
    }
    this.teams = restoredTeams;
    this.normalizeRetentionState();
    this.userTargetPlan = userTargetPlan;
    for (const franchise of FRANCHISES) {
      const savedRetention = snapshot.teams[franchise.code].retention;
      const actual = this.teams[franchise.code].retention;
      if (savedRetention && (
        savedRetention.franchiseId !== franchise.code ||
        savedRetention.slotsUsed !== actual.slotsUsed ||
        savedRetention.configuredLimit != null && savedRetention.configuredLimit !== actual.configuredLimit ||
        savedRetention.totalCost !== actual.totalCost ||
        savedRetention.remainingPurse !== actual.remainingPurse ||
        JSON.stringify(savedRetention.retainedPlayerIds) !== JSON.stringify(actual.retainedPlayerIds) ||
        JSON.stringify(savedRetention.retainedPlayerNames) !== JSON.stringify(actual.retainedPlayerNames) ||
        JSON.stringify(savedRetention.finalSquadPlayerIds) !== JSON.stringify(actual.finalSquadPlayerIds) ||
        !Array.isArray(savedRetention.retainedPlayers) ||
        savedRetention.retainedPlayers.length !== actual.retainedPlayers.length ||
        savedRetention.retainedPlayers.some((record, index) =>
          record.id !== actual.retainedPlayers[index]?.id ||
          record.name !== actual.retainedPlayers[index]?.name ||
          record.slot !== actual.retainedPlayers[index]?.slot ||
          record.cost !== actual.retainedPlayers[index]?.cost
        )
      )) {
        throw new Error(`Saved retention record for ${franchise.code} does not match its squad.`);
      }
    }
    if (this.retainedIds.size !== retainedIds.size ||
        [...retainedIds].some((id) => !this.retainedIds.has(id))) {
      throw new Error("Saved retention records do not match retained squad membership.");
    }
    for (const franchise of FRANCHISES) {
      const retention = this.teams[franchise.code].retention;
      const releasedIds = retention.releasedPlayerIds ?? [];
      const releasedRecords = retention.releasedPlayers ?? [];
      if (!Array.isArray(releasedIds) || !Array.isArray(releasedRecords) ||
          new Set(releasedIds).size !== releasedIds.length ||
          releasedRecords.length !== releasedIds.length ||
          releasedRecords.some((record, index) => {
            const player = byId.get(record?.playerId);
            return !player ||
              releasedIds[index] !== record.playerId ||
              record.releasedBy !== franchise.code ||
              !isRetentionCandidateFor(player, franchise.code, this.auctionSeason) ||
              this.retainedIds.has(player.id) ||
              record.status !== "released" ||
              record.auctionEligibility !== (Number.isInteger(player.basePrice)
                ? "base-price-configured"
                : "excluded-no-configured-base-price");
          })) {
        throw new Error(`Saved release records for ${franchise.code} are invalid.`);
      }
    }
    if (soldPlayerIds.some((id) => !byId.has(id)) ||
        soldPlayerIds.length !== purchasedIds.size ||
        soldPlayerIds.some((id) => !purchasedIds.has(id)) ||
        finalized.some((id) => !byId.has(id)) ||
        (leadingTeam && !snapshot.teams[leadingTeam])) {
      throw new Error("Saved auction results are inconsistent.");
    }
    if (leadingTeam && state !== GAME_STATES.COMPLETE &&
        restoredTeams[leadingTeam].purse < currentBid) {
      throw new Error("Saved leading bid exceeds the franchise purse.");
    }
    if (new Set(soldPlayerIds).size !== soldPlayerIds.length ||
        new Set(finalized).size !== finalized.length ||
        withdrawn.some((code) => !FRANCHISES.some((team) => team.code === code)) ||
        skipped.some((code) => !FRANCHISES.some((team) => team.code === code))) {
      throw new Error("Saved auction contains duplicate or invalid team/player references.");
    }
    const historyResults = new Set(["bid", "sold", "pass", "skipped", "unsold"]);
    if (history.some((item) => !item || !byId.has(item.playerId) || !historyResults.has(item.result) ||
        item.skipReason != null && (item.result !== "skipped" || item.skipReason !== "USER_SKIPPED") ||
        (item.teamCode != null && !FRANCHISES.some((team) => team.code === item.teamCode)) ||
        (["bid", "sold"].includes(item.result) && (!Number.isInteger(item.amount) || item.amount < byId.get(item.playerId).basePrice)))) {
      throw new Error("Saved auction history is malformed.");
    }
    const terminalResults = history.filter((item) =>
      ["sold", "unsold"].includes(item.result) ||
      item.result === "skipped" && item.skipReason === "USER_SKIPPED"
    );
    const resolvedIds = new Set(terminalResults.map((item) => item.playerId));
    const historySoldIds = new Set(history.filter((item) => item.result === "sold").map((item) => item.playerId));
    if (resolvedIds.size !== terminalResults.length ||
        resolvedIds.size !== finalized.length ||
        finalized.some((id) => !resolvedIds.has(id)) ||
        historySoldIds.size !== soldPlayerIds.length ||
        soldPlayerIds.some((id) => !historySoldIds.has(id)) ||
        [GAME_STATES.BIDDING_OPEN, GAME_STATES.GOING_ONCE, GAME_STATES.GOING_TWICE, GAME_STATES.FINAL_CALL].includes(state) &&
          finalized.includes(queueIds[index]) ||
        state === GAME_STATES.SOLD && !soldPlayerIds.includes(queueIds[index]) ||
        state === GAME_STATES.UNSOLD && (soldPlayerIds.includes(queueIds[index]) ||
          !finalized.includes(queueIds[index])) ||
        state === GAME_STATES.SKIPPED && (soldPlayerIds.includes(queueIds[index]) ||
          !finalized.includes(queueIds[index]) ||
          !history.some((item) => item.playerId === queueIds[index] && item.result === "skipped" &&
            item.skipReason === "USER_SKIPPED")) ||
        state === GAME_STATES.COMPLETE && finalized.length !== queueIds.length) {
      throw new Error("Saved auction lot results do not match its state.");
    }
    if (leadingTeam && state !== GAME_STATES.COMPLETE &&
        !history.some((item) => item.result === "bid" && item.playerId === queueIds[index] &&
          item.teamCode === leadingTeam && item.amount === currentBid)) {
      throw new Error("Saved leading bid does not match the auction history.");
    }
    this.userTeam = snapshot.userTeam;
    this.mode = snapshot.mode;
    this.auctionSeason = snapshot.auctionSeason ?? 2026;
    this.customRetentionLimit = snapshot.customRetentionLimit ?? CUSTOM_RULES.megaRetentionLimit;
    this.rtmEnabled = hasRTMPending ? true : snapshot.rtmEnabled === true;
    this.rtmLimit = Number.isInteger(snapshot.rtmLimit) && snapshot.rtmLimit >= 0
      ? snapshot.rtmLimit
      : CUSTOM_RULES.rtmLimitPerFranchise;
    this.rtmUsedByTeam = Object.fromEntries(FRANCHISES.map(({ code }) => [
      code,
      snapshot.rtmUsedByTeam?.[code] ?? 0
    ]));
    if (Object.values(this.rtmUsedByTeam).some((count) => !Number.isInteger(count) || count < 0 || count > this.rtmLimit)) {
      throw new Error("Saved RTM usage is invalid.");
    }
    this.pendingRTM = hasRTMPending ? snapshot.pendingRTM : null;
    this.difficulty = snapshot.difficulty;
    this.pacing = snapshot.pacing;
    this.isPaused = snapshot.isPaused === true;
    this.seed = snapshot.seed;
    this.openingComplete = snapshot.openingComplete === true ||
      (snapshot.openingComplete == null &&
        (index > 0 || state !== GAME_STATES.READY || (snapshot.announcedCategories?.length ?? 0) > 0));
    this.openingPending = false;
    const ownerByPlayer = new Map(FRANCHISES.flatMap((team) =>
      restoredTeams[team.code].squad.map((player) => [player.id, team.code])
    ));
    const releasedByPlayer = new Map(FRANCHISES.flatMap(({ code }) =>
      (restoredTeams[code].retention.releasedPlayers ?? [])
        .map((release) => [release.playerId, code])
    ));
    this.queue = queueIds.map((id, position) => {
      const player = byId.get(id);
      const category = auctionCategory(player);
      const releasedBy = releasedByPlayer.get(id);
      return {
        ...player,
        ...(releasedBy ? { releasedBy } : {}),
        ...(releasedBy && verifiedPreviousOwner(player, this.auctionSeason) === releasedBy
          ? { rtmEligible: true, rtmOwner: releasedBy }
          : { rtmEligible: false, rtmOwner: null }),
        lotNumber: queueLotNumbers[position],
        auctionCategory: category,
        auctionSetNumber: AUCTION_CATEGORY_ORDER.indexOf(category) + 1,
        auctionSetName: category,
        auctionCatalogueStatus: "custom simulation order; no verified official set order",
        queuePosition: queueLotNumbers[position],
        auctionStatus: soldPlayerIds.includes(id) ? "SOLD" :
          finalized.includes(id)
            ? history.some((item) => item.playerId === id && item.result === "skipped" && item.skipReason === "USER_SKIPPED")
              ? "SKIPPED"
              : "UNSOLD"
            : "AVAILABLE_FOR_AUCTION",
        currentOwner: ownerByPlayer.get(id) ?? null
      };
    });
    this.index = index;
    this.state = state;
    this.activeSessionId = [GAME_STATES.INTRODUCING, GAME_STATES.BIDDING_OPEN, GAME_STATES.GOING_ONCE,
      GAME_STATES.GOING_TWICE, GAME_STATES.FINAL_CALL, GAME_STATES.RTM_PENDING].includes(state)
      ? `${this.engineSessionId}:${index}:${this.currentPlayer?.id}:${++this.sessionSequence}`
      : null;
    this.lastResultSessionId = [GAME_STATES.SOLD, GAME_STATES.UNSOLD, GAME_STATES.SKIPPED].includes(state)
      ? `${this.engineSessionId}:result:${index}:${this.currentPlayer?.id}:${++this.sessionSequence}`
      : null;
    this.pendingRTM = this.pendingRTM && this.activeSessionId
      ? { ...this.pendingRTM, sessionId: this.activeSessionId }
      : null;
    this.currentBid = currentBid;
    this.leadingTeam = leadingTeam;
    this.withdrawn = new Set(withdrawn);
    this.skipped = new Set(skipped);
    this.history = history;
    this.soldPlayerIds = new Set(soldPlayerIds);
    this.teams = restoredTeams;
    this.normalizeRetentionState();
    this.finalized = new Set(finalized);
    this.announcedCategories = new Set(snapshot.announcedCategories ?? []);
    this.pacing = snapshot.pacing ?? "Relaxed";
    this.finalCallRemainingMs = Number.isFinite(snapshot.finalCallRemainingMs) && snapshot.finalCallRemainingMs >= 0
      ? snapshot.finalCallRemainingMs
      : null;
  }
}

function verifiedPreviousOwner(player, auctionSeason = 2026) {
  if (Number(auctionSeason) >= 2026 && player.season2026AssociationStatus === "verified" && player.season2026FranchiseCode) return player.season2026FranchiseCode;
  if (player.originalFranchiseStatus === "verified" && player.originalFranchiseCode) return player.originalFranchiseCode;
  if (player.previousFranchiseStatus === "verified" && player.previousFranchiseCode) return player.previousFranchiseCode;
  return null;
}
