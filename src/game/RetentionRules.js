import { CUSTOM_RULES, FRANCHISES, createFranchiseState } from "../data/franchises.js";

export function retentionLimit(mode, customLimit = CUSTOM_RULES.megaRetentionLimit) {
  if (mode === "Mega Auction") return CUSTOM_RULES.megaRetentionLimit;
  if (mode === "Mini Auction") return CUSTOM_RULES.miniRetentionLimit;
  if (mode === "Custom Auction") {
    if (!Number.isInteger(customLimit) || customLimit < 0 || customLimit > CUSTOM_RULES.miniRetentionLimit) {
      throw new Error(`Custom retention limit must be between 0 and ${CUSTOM_RULES.miniRetentionLimit}.`);
    }
    return customLimit;
  }
  return 0;
}

export function retentionCosts(mode, customLimit = CUSTOM_RULES.megaRetentionLimit) {
  if (mode === "Mega Auction") return CUSTOM_RULES.megaRetentionCosts;
  if (mode === "Mini Auction") return CUSTOM_RULES.miniRetentionCosts;
  if (mode === "Custom Auction") {
    return customLimit > CUSTOM_RULES.megaRetentionLimit
      ? CUSTOM_RULES.miniRetentionCosts
      : CUSTOM_RULES.megaRetentionCosts;
  }
  return [];
}

export function createSampleHistory(players, { auctionSeason = 2026 } = {}) {
  return Object.fromEntries(FRANCHISES.map((team) => [
    team.code,
    [...new Map(players
      .filter((player) => isRetentionCandidateFor(player, team.code, auctionSeason))
      .map((player) => [player.id, player])).values()]
  ]));
}

export function isRetentionCandidateFor(player, teamCode, auctionSeason = 2026) {
  if (Number(auctionSeason) >= 2026 && player.season2026AssociationStatus === "verified") {
    return player.season2026SquadStatus === "retained" &&
      player.retentionEligible === true &&
      player.season2026FranchiseCode === teamCode;
  }
  if (player.originalFranchiseStatus === "verified") return player.originalFranchiseCode === teamCode;
  if (player.previousFranchiseStatus === "verified") return player.previousFranchiseCode === teamCode;
  if (player?.seedFranchiseCodes?.includes(teamCode)) return true;
  if ([player.season2026AssociationStatus, player.originalFranchiseStatus, player.previousFranchiseStatus]
    .some((status) => status && status !== "unknown")) return false;
  return false;
}

function estimatedRetentionAbility(player) {
  const ratings = player.simulationRatings ?? {};
  const batting = ratings.batting?.value ?? player.rating ?? 50;
  const bowling = ratings.bowling?.value ?? 50;
  const keeping = ratings.wicketkeeping?.value ?? 45;
  if (player.role === "bowler") return bowling;
  if (player.role === "allrounder") return (batting + bowling) / 2;
  if (player.role === "wicketkeeper") return batting * 0.65 + keeping * 0.35;
  return batting;
}

function advisePlayerRetention(player, team, selected, candidates, slotCost) {
  const roleCount = selected.filter((item) => item.role === player.role).length;
  const roleNeed = Math.max(0, (team.needs[player.role] ?? 0) - roleCount);
  const sameRoleOptions = candidates.filter((item) => item.role === player.role).length;
  const scarcity = 1 / Math.max(1, sameRoleOptions);
  const versatility = Math.max(0, (player.roleGroups?.length ?? 1) - 1);
  const ability = estimatedRetentionAbility(player);
  const confidence = player.dataConfidence === "very low" ? 0.55 :
    player.dataConfidence === "low" ? 0.78 : player.statsVerified ? 1 : 0.7;
  const evidenceBonus = player.statsVerified ? 9 : 0;
  const focusBonus = team.strategy.focusRoles.includes(player.role) ? 5 : 0;
  const costPenalty = slotCost / 150;
  const score = Math.round((ability * confidence + evidenceBonus + roleNeed * 9 +
    Math.min(20, scarcity * 100) + versatility * 4 + focusBonus - costPenalty) * 10) / 10;
  const reasons = [`${player.role} role need: ${roleNeed} unfilled`];
  if (sameRoleOptions <= 2) reasons.push(`only ${sameRoleOptions} same-role replacement option${sameRoleOptions === 1 ? "" : "s"} in the seed pool`);
  if (versatility) reasons.push(`${versatility} additional curated role group${versatility === 1 ? "" : "s"}`);
  if (player.statsVerified) reasons.push("has sourced performance data");
  else reasons.push(`estimated ability ${Math.round(ability)}/100; ${player.dataConfidence ?? "low"} data confidence`);
  reasons.push(`custom slot cost ${slotCost} lakh`);
  return {
    playerId: player.id,
    playerName: player.name,
    role: player.role,
    score,
    confidence: player.dataConfidence ?? "low",
    reasons
  };
}

export function recommendFranchiseRetentions({ sampleHistory, mode, userTeam, auctionSeason = 2026, customRetentionLimit = CUSTOM_RULES.megaRetentionLimit }) {
  const limit = retentionLimit(mode, customRetentionLimit);
  const costs = retentionCosts(mode, customRetentionLimit);
  const usedPlayerIds = new Set();
  const recommendations = {};
  for (const franchise of FRANCHISES) {
    if (franchise.code === userTeam) {
      recommendations[franchise.code] = { retainedIds: [], decisions: [] };
      continue;
    }
    const team = createFranchiseState()[franchise.code];
    const candidates = [...new Map((sampleHistory[franchise.code] ?? [])
      .filter((player) => isRetentionCandidateFor(player, franchise.code, auctionSeason) &&
        player.role !== "unknown" && !usedPlayerIds.has(player.id))
      .map((player) => [player.id, player])).values()];
    const retained = [];
    const decisions = [];
    for (let slot = 0; slot < limit; slot += 1) {
      const slotCost = costs[slot];
      if (!Number.isInteger(slotCost) || slotCost > team.purse) break;
      const ranked = candidates
        .filter((player) => !retained.some((item) => item.id === player.id))
        .filter((player) => player.isOverseas !== true ||
          retained.filter((item) => item.isOverseas === true).length < CUSTOM_RULES.maxOverseas)
        .map((player) => ({
          player,
          decision: advisePlayerRetention(player, team, retained, candidates, slotCost)
        }))
        .sort((a, b) => b.decision.score - a.decision.score || a.player.id.localeCompare(b.player.id));
      const chosen = ranked[0];
      if (!chosen) break;
      retained.push(chosen.player);
      decisions.push({ ...chosen.decision, slot: slot + 1, cost: slotCost });
      usedPlayerIds.add(chosen.player.id);
    }
    recommendations[franchise.code] = {
      retainedIds: retained.map((player) => player.id),
      decisions
    };
  }
  return recommendations;
}

export function retentionCost(mode, retainedCount, customLimit = CUSTOM_RULES.megaRetentionLimit) {
  return retentionCosts(mode, customLimit).slice(0, retainedCount).reduce((sum, amount) => sum + amount, 0);
}

export function buildTeamsAfterRetention({
  mode,
  sampleHistory,
  userTeam,
  userRetainedIds,
  retainedIdsByTeam = null,
  retentionAdvice = null,
  auctionSeason = 2026,
  customRetentionLimit = CUSTOM_RULES.megaRetentionLimit
}) {
  if (!FRANCHISES.some((team) => team.code === userTeam)) {
    throw new Error("Choose a valid franchise before confirming retentions.");
  }
  if (retainedIdsByTeam == null &&
      (!Array.isArray(userRetainedIds) || new Set(userRetainedIds).size !== userRetainedIds.length)) {
    throw new Error("Selected retentions must contain unique player IDs.");
  }
  const limit = retentionLimit(mode, customRetentionLimit);
  const costs = retentionCosts(mode, customRetentionLimit);
  const teams = createFranchiseState();
  const retainedIds = new Set();
  const explicitSelections = retainedIdsByTeam !== null;
  if (explicitSelections && (!retainedIdsByTeam || typeof retainedIdsByTeam !== "object")) {
    throw new Error("Retention selections must be supplied for valid franchises.");
  }
  if (explicitSelections && Object.keys(retainedIdsByTeam).some((code) =>
    !FRANCHISES.some((team) => team.code === code)
  )) {
    throw new Error("Retention selections contain an invalid franchise ID.");
  }
  for (const team of FRANCHISES) {
    const historyCandidates = (sampleHistory[team.code] ?? [])
      .filter((player) => isRetentionCandidateFor(player, team.code, auctionSeason) && !retainedIds.has(player.id))
    const squad = [...new Map(historyCandidates
      .map((player) => [player.id, player])).values()];
    let retained;
    if (explicitSelections) {
      const selectedIds = retainedIdsByTeam[team.code] ?? [];
      if (!Array.isArray(selectedIds) || new Set(selectedIds).size !== selectedIds.length) {
        throw new Error(`${team.name} retention selections must contain unique player IDs.`);
      }
      if (selectedIds.length > limit) {
        throw new Error(`${team.name} exceeds the ${limit}-player retention limit.`);
      }
      const eligibleById = new Map(squad.map((player) => [player.id, player]));
      const invalid = selectedIds.find((id) => !eligibleById.has(id));
      if (invalid) throw new Error(`${team.name} cannot retain ineligible player ${invalid}.`);
      retained = selectedIds.map((id) => eligibleById.get(id));
    } else if (team.code === userTeam) {
      if (!Array.isArray(userRetainedIds) || new Set(userRetainedIds).size !== userRetainedIds.length) {
        throw new Error("Selected retentions must contain unique player IDs.");
      }
      if (userRetainedIds.length > limit) {
        throw new Error(`${team.name} exceeds the ${limit}-player retention limit.`);
      }
      const eligibleById = new Map(squad.map((player) => [player.id, player]));
      const invalid = userRetainedIds.find((id) => !eligibleById.has(id));
      if (invalid) throw new Error(`${team.name} cannot retain ineligible player ${invalid}.`);
      retained = userRetainedIds.map((id) => eligibleById.get(id));
    } else {
      retained = [];
      const remaining = [...squad];
      while (retained.length < limit && remaining.length) {
        remaining.sort((a, b) =>
          advisePlayerRetention(b, teams[team.code], retained, squad, costs[retained.length]).score -
          advisePlayerRetention(a, teams[team.code], retained, squad, costs[retained.length]).score
        );
        const candidate = remaining.shift();
        const slotCost = costs[retained.length];
        if (slotCost == null || retained.reduce((sum, item, index) => sum + costs[index], 0) + slotCost > teams[team.code].purse) break;
        if (candidate.isOverseas &&
            retained.filter((player) => player.isOverseas).length >= CUSTOM_RULES.maxOverseas) continue;
        retained.push(candidate);
      }
    }
    const accepted = [];
    let cost = 0;
    let overseasCount = 0;
    for (const player of retained) {
      const slotCost = costs[accepted.length];
      if (slotCost == null || cost + slotCost > CUSTOM_RULES.purse) {
        if (team.code === userTeam) throw new Error(`${team.name} cannot afford the selected retentions.`);
        break;
      }
      if (player.isOverseas && overseasCount >= CUSTOM_RULES.maxOverseas) continue;
      accepted.push(player);
      cost += slotCost;
      if (player.isOverseas) overseasCount += 1;
    }
    retained = accepted;
    const retainedPlayers = retained.map((player, index) => ({
      id: player.id,
      name: player.name,
      slot: index + 1,
      cost: costs[index]
    }));
    const remainingPurse = CUSTOM_RULES.purse - cost;
    teams[team.code] = {
      ...teams[team.code],
      purse: remainingPurse,
      squad: retained.map((player, index) => ({
        ...player,
        purchasePrice: 0,
        retentionCost: costs[index],
        purchaseOrder: index + 1,
        retained: true,
        currentOwner: team.code,
        auctionStatus: "RETAINED"
      })),
      history: retained.map((player, index) => ({
        playerId: player.id,
        amount: costs[index],
        result: "retained",
        lotNumber: null
      })),
      retention: {
        franchiseId: team.code,
        retainedPlayers,
        retainedPlayerIds: retainedPlayers.map((player) => player.id),
        retainedPlayerNames: retainedPlayers.map((player) => player.name),
        slotsUsed: retainedPlayers.length,
        totalCost: cost,
        remainingPurse,
        finalSquadPlayerIds: retained.map((player) => player.id),
        releasedPlayerIds: [],
        releasedPlayers: [],
        advisorRecommendations: retentionAdvice?.[team.code]?.decisions ?? [],
        configuredLimit: limit,
        pricingMethod: "configured custom simulation slot costs"
      }
    };
    for (const player of retained) {
      if (retainedIds.has(player.id)) {
        throw new Error(`${player.name} cannot be retained by more than one franchise.`);
      }
      retainedIds.add(player.id);
    }
  }
  for (const team of FRANCHISES) {
    const releasedPlayers = [...new Map((sampleHistory[team.code] ?? [])
      .filter((player) => isRetentionCandidateFor(player, team.code, auctionSeason) && !retainedIds.has(player.id))
      .map((player) => [player.id, player])).values()];
    const releasedRecords = releasedPlayers.map((player) => ({
      playerId: player.id,
      playerName: player.name,
      releasedBy: team.code,
      status: "released",
      auctionEligibility: Number.isInteger(player.basePrice)
        ? "base-price-configured"
        : "excluded-no-configured-base-price"
    }));
    teams[team.code].retention.releasedPlayerIds = releasedRecords.map((record) => record.playerId);
    teams[team.code].retention.releasedPlayers = releasedRecords;
    teams[team.code].retention.finalSquadPlayerIds = teams[team.code].squad.map((player) => player.id);
  }
  return { teams };
}

