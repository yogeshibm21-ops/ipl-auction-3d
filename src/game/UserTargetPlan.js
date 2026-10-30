const PRIORITIES = new Set(["primary", "secondary", "backup"]);

export function validateUserTargetPlan(plan, players, { retainedIds = new Set(), purse = 12000 } = {}) {
  if (!Array.isArray(plan)) throw new Error("The target plan must be a list.");
  const playersById = new Map(players.map((player) => [player.id, player]));
  const seen = new Set();
  return plan.map((target, index) => {
    const player = playersById.get(target?.playerId);
    if (!player) throw new Error(`Target ${index + 1} references an unknown player.`);
    if (seen.has(player.id)) throw new Error(`${player.name} appears more than once in the target plan.`);
    if (retainedIds.has(player.id)) throw new Error(`${player.name} is retained and cannot be an auction target.`);
    if (!PRIORITIES.has(target.priority)) throw new Error(`Target priority for ${player.name} is invalid.`);
    if (!Number.isInteger(target.spendLimit) || target.spendLimit < player.basePrice || target.spendLimit > purse) {
      throw new Error(`Preferred spending limit for ${player.name} must be between base price and available purse.`);
    }
    if (!Number.isInteger(target.rolePriority) || target.rolePriority < 1 || target.rolePriority > 4) {
      throw new Error(`Role priority for ${player.name} must be between 1 and 4.`);
    }
    seen.add(player.id);
    return {
      playerId: player.id,
      priority: target.priority,
      spendLimit: target.spendLimit,
      rolePriority: target.rolePriority,
      order: index
    };
  });
}

export function plannedSpend(plan) {
  return plan.reduce((total, target) => total + target.spendLimit, 0);
}
