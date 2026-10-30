const ROLE_TARGETS = Object.freeze({
  batter: 5,
  wicketkeeper: 2,
  allrounder: 4,
  bowler: 7
});

const DIFFICULTY = Object.freeze({
  Easy: { insight: 0.82, conservatism: 0.92 },
  Normal: { insight: 1, conservatism: 1 },
  Hard: { insight: 1.16, conservatism: 1.06 }
});

function historicalAdjustment(player) {
  const stats = player.historicalStats;
  if (!stats || player.statsVerified !== true) return 0;
  const metrics = [];
  for (const value of [stats.battingImpact, stats.bowlingImpact, stats.fieldingImpact]) {
    if (Number.isFinite(value)) metrics.push(Math.max(-20, Math.min(20, value)));
  }
  return metrics.length ? metrics.reduce((sum, value) => sum + value, 0) / metrics.length : 0;
}

function ratingValue(player, key, fallback = 50, auctionSeason = 2026) {
  const record = player.simulationRatingsByAuctionSeason?.[auctionSeason]?.[key] ?? player.simulationRatings?.[key];
  if (Number.isFinite(record?.value)) return record.value;
  return Number.isFinite(player.rating) ? player.rating : fallback;
}

function confidenceFactor(player) {
  if (player.dataConfidence === "very low") return 0.68;
  if (player.dataConfidence === "low") return 0.82;
  if (player.statsVerified === true) return 0.9;
  return 0.76;
}

function demandFromCompetitors(player, team, teams) {
  return teams.filter((candidate) => candidate.code !== team.code).reduce((sum, candidate) => {
    const target = candidate.needs?.[player.role] ?? 0;
    const filled = candidate.squad.filter((squadPlayer) => squadPlayer.role === player.role).length;
    return sum + Math.max(0, target - filled);
  }, 0);
}

function poolScarcity(player, remainingPlayers) {
  const sameRoleCount = remainingPlayers.filter((candidate) => candidate.role === player.role).length;
  const ratio = ROLE_TARGETS[player.role] / Math.max(1, sameRoleCount);
  return Math.min(1.24, 0.9 + ratio * 0.18);
}

export function reserveForMandatorySlots(team, rules) {
  const mandatorySlots = Math.max(0, rules.minSquad - team.squad.length - 1);
  return Math.min(team.purse, mandatorySlots * rules.minimumBid);
}

export function legalMaximumBid(team, player, rules) {
  if (team.squad.length >= rules.maxSquad) return 0;
  const overseasCount = team.squad.reduce((count, squadPlayer) => count + Number(squadPlayer.isOverseas), 0);
  if (player.isOverseas && overseasCount >= rules.maxOverseas) return 0;
  return Math.max(0, team.purse - reserveForMandatorySlots(team, rules));
}

export function evaluatePlayerValue({ player, team, remainingPlayers, teams = [], auctionSeason = 2026, difficulty = "Normal", rules }) {
  const battingRating = ratingValue(player, "batting", 50, auctionSeason);
  const bowlingRating = ratingValue(player, "bowling", 50, auctionSeason);
  const wicketkeepingRating = ratingValue(player, "wicketkeeping", player.role === "wicketkeeper" ? 55 : 45, auctionSeason);
  const allRoundRating = ratingValue(player, "allRoundAbility", 50, auctionSeason);
  const skillRating = player.role === "bowler" ? bowlingRating :
    player.role === "allrounder" ? (battingRating + bowlingRating) / 2 :
      player.role === "wicketkeeper" ? battingRating * 0.65 + wicketkeepingRating * 0.35 : battingRating;
  const rating = Math.max(25, Math.min(82, skillRating));
  const roleCount = team.squad.filter((squadPlayer) => squadPlayer.role === player.role).length;
  const roleTarget = ROLE_TARGETS[player.role] ?? 3;
  const need = Math.max(0, Math.min(1, (roleTarget - roleCount) / roleTarget));
  const personality = team.strategy ?? {};
  const focus = personality.focusRoles?.includes(player.role) ? 1 : 0;
  const profile = DIFFICULTY[difficulty] ?? DIFFICULTY.Normal;
  const skillValue = rating * rating * 0.36;
  const keeperNeed = player.role === "wicketkeeper" ? need :
    Math.max(0, Math.min(1, (ROLE_TARGETS.wicketkeeper - team.squad.filter((item) => item.role === "wicketkeeper").length) / ROLE_TARGETS.wicketkeeper));
  const battingNeed = Math.max(0, Math.min(1, (ROLE_TARGETS.batter - team.squad.filter((item) => item.role === "batter").length) / ROLE_TARGETS.batter));
  const bowlingNeed = Math.max(0, Math.min(1, (ROLE_TARGETS.bowler - team.squad.filter((item) => item.role === "bowler").length) / ROLE_TARGETS.bowler));
  const allRoundNeedBonus = player.role === "allrounder" && battingNeed > 0.35 && bowlingNeed > 0.35 &&
    battingRating >= 58 && bowlingRating >= 58 ? 1.08 : 1;
  const roleFit = 0.72 + need * 0.58 * profile.insight + focus * 0.08;
  const scarcity = poolScarcity(player, remainingPlayers);
  const competingDemand = demandFromCompetitors(player, team, teams);
  const demandFactor = Math.min(1.2, 1 + competingDemand * 0.025);
  const dataFactor = confidenceFactor(player);
  const historicalValue = historicalAdjustment(player) * 12;
  const basePrice = Number.isFinite(player.basePrice) ? player.basePrice : rules.minimumBid;
  const riskTolerance = personality.riskTolerance ?? 1;
  const valueFactors = skillValue * roleFit * scarcity * demandFactor * dataFactor * allRoundNeedBonus;
  const estimatedValue = Math.max(basePrice, Math.floor(valueFactors + historicalValue));
  const strategicCeiling = Math.floor(Math.max(basePrice,
    (valueFactors + historicalValue) * riskTolerance * profile.conservatism));
  const affordableCeiling = legalMaximumBid(team, player, rules);
  const positives = [];
  const risks = [];
  if (need > 0.4) positives.push(`Fills ${player.role} need (${Math.round(need * 100)}% unmet)`);
  if (scarcity > 1) positives.push("Few same-role alternatives remain");
  if (competingDemand > 0) positives.push(`${competingDemand} competing role slots remain across franchises`);
  if (player.role === "allrounder" && allRoundNeedBonus > 1) positives.push("Both batting and bowling needs are material");
  if (player.statsVerified) positives.push("Some IPL 2025 statistics have a source and period");
  if (dataFactor < 0.8) risks.push("Very limited verified evidence; confidence discount applied");
  else if (dataFactor < 0.9) risks.push("Statistics or role evidence is incomplete");
  if (player.role === "allrounder" && Math.min(battingRating, bowlingRating) < 58) risks.push("One simulation skill is below the all-round threshold");
  if (player.role === "wicketkeeper" && wicketkeepingRating < 55) risks.push("Wicketkeeping ability is estimated with limited evidence");
  if (!Number.isFinite(player.basePrice)) risks.push("Auction base price is unavailable");
  const valueRange = {
    minimum: Math.max(basePrice, Math.floor(estimatedValue * 0.82)),
    maximum: Math.max(basePrice, Math.ceil(estimatedValue * 1.18))
  };
  return {
    playerId: player.id,
    estimatedValue,
    valueRange,
    recommendedBidLimit: Math.min(strategicCeiling, affordableCeiling),
    confidence: dataFactor >= 0.9 ? "medium" : dataFactor >= 0.8 ? "low" : "very low",
    confidenceFactor: dataFactor,
    positiveFactors: positives,
    risks,
    squadNeedAdjustment: { role: player.role, roleNeed: need, wicketkeeperNeed: keeperNeed },
    skillRatings: { batting: battingRating, bowling: bowlingRating, wicketkeeping: wicketkeepingRating, allRoundAbility: allRoundRating },
    strategicCeiling: Math.min(strategicCeiling, affordableCeiling),
    affordableCeiling,
    reserve: reserveForMandatorySlots(team, rules),
    roleNeed: need,
    roleCount,
    roleTarget,
    scarcity,
    competingDemand,
    demandFactor,
    historicalAdjustment: historicalValue,
    focusRole: focus > 0,
    eligible: affordableCeiling >= player.basePrice
  };
}

export function buildTeamStrategyPlan({ team, players, teams = [], auctionSeason = 2026, rules, difficulty = "Normal" }) {
  const roles = {};
  const roleNeeds = Object.fromEntries(Object.entries(team.needs ?? {}).map(([role, target]) => [
    role,
    Math.max(0, target - team.squad.filter((player) => player.role === role).length)
  ]));
  for (const [role, need] of Object.entries(roleNeeds)) {
    if (!need) {
      roles[role] = { required: 0, targets: [] };
      continue;
    }
    const targets = players
      .filter((player) => player.role === role)
      .map((player) => {
        const evaluation = evaluatePlayerValue({
          player,
          team,
          remainingPlayers: players,
          teams,
          auctionSeason,
          difficulty,
          rules
        });
        const urgency = Math.min(1, need / Math.max(1, team.needs[role]));
        const priorityScore = Math.round(
          evaluation.estimatedValue + urgency * 100 + evaluation.scarcity * 20 - player.basePrice * 0.1
        );
        return { player, evaluation, priorityScore };
      })
      .filter(({ evaluation }) => evaluation.eligible)
      .sort((a, b) =>
        b.priorityScore - a.priorityScore ||
        a.player.basePrice - b.player.basePrice ||
        a.player.id.localeCompare(b.player.id)
      )
      .slice(0, 3)
      .map(({ player, evaluation, priorityScore }, index) => ({
        tier: ["primary", "secondary", "backup"][index],
        playerId: player.id,
        playerName: player.name,
        role,
        maximumBid: evaluation.strategicCeiling,
        priorityScore,
        reason: `${need} ${role} slot${need === 1 ? "" : "s"} still needed; target fits the franchise's ${team.personality} strategy.`
      }));
    roles[role] = { required: need, targets };
  }
  return {
    franchiseId: team.code,
    personality: team.personality,
    purse: team.purse,
    squadSize: team.squad.length,
    overseasCount: team.squad.filter((player) => player.isOverseas).length,
    roleNeeds,
    roles
  };
}

export function aiBidDecision({ player, team, remainingPlayers, teams = [], auctionSeason = 2026, currentBid, nextBid, difficulty = "Normal", rules }) {
  const evaluation = evaluatePlayerValue({ player, team, remainingPlayers, teams, auctionSeason, difficulty, rules });
  const priceStretch = team.strategy?.priceStretch ?? 1;
  const limit = Math.min(evaluation.strategicCeiling * priceStretch, evaluation.affordableCeiling);
  const canBid = evaluation.eligible && nextBid !== null && nextBid <= limit;
  return {
    ...evaluation,
    limit: Math.floor(limit),
    nextBid,
    currentBid,
    canBid,
    reason: !evaluation.eligible
      ? "Roster or purse reserve makes this bid illegal."
      : canBid
        ? `${evaluation.roleNeed > 0.45 ? "Strong role need" : "Roster fit"}; bid remains within strategic value and reserve.`
        : "Next legal increment exceeds the strategic ceiling."
  };
}
