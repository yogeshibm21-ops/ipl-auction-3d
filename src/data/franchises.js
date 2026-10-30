export const FRANCHISES = [
  { code: "CSK", name: "Chennai Super Kings", short: "Chennai", colors: ["#f7c928", "#173d79"], personality: "balanced", strategy: { riskTolerance: 1.03, priceStretch: 1.02, focusRoles: ["allrounder", "bowler"] } },
  { code: "MI", name: "Mumbai Indians", short: "Mumbai", colors: ["#1687d9", "#164078"], personality: "aggressive", strategy: { riskTolerance: 1.2, priceStretch: 1.08, focusRoles: ["allrounder", "bowler"] } },
  { code: "RCB", name: "Royal Challengers Bengaluru", short: "Bengaluru", colors: ["#e63346", "#171717"], personality: "batting", strategy: { riskTolerance: 1.12, priceStretch: 1.05, focusRoles: ["batter", "wicketkeeper"] } },
  { code: "KKR", name: "Kolkata Knight Riders", short: "Kolkata", colors: ["#8b55bd", "#f1c847"], personality: "allrounder", strategy: { riskTolerance: 1.1, priceStretch: 1.04, focusRoles: ["allrounder", "wicketkeeper"] } },
  { code: "SRH", name: "Sunrisers Hyderabad", short: "Hyderabad", colors: ["#f47a21", "#252525"], personality: "bowling", strategy: { riskTolerance: 1.08, priceStretch: 1.04, focusRoles: ["bowler", "allrounder"] } },
  { code: "RR", name: "Rajasthan Royals", short: "Rajasthan", colors: ["#e85c9a", "#254784"], personality: "youth", strategy: { riskTolerance: 1.03, priceStretch: 1, focusRoles: ["batter", "bowler"] } },
  { code: "PBKS", name: "Punjab Kings", short: "Punjab", colors: ["#e43943", "#dadde2"], personality: "opportunistic", strategy: { riskTolerance: 1.07, priceStretch: 1.03, focusRoles: ["batter", "allrounder"] } },
  { code: "DC", name: "Delhi Capitals", short: "Delhi", colors: ["#2876c6", "#d73649"], personality: "balanced", strategy: { riskTolerance: 1, priceStretch: 1, focusRoles: ["wicketkeeper", "bowler"] } },
  { code: "GT", name: "Gujarat Titans", short: "Gujarat", colors: ["#4ea4a8", "#263e5d"], personality: "budget", strategy: { riskTolerance: 0.9, priceStretch: 0.96, focusRoles: ["batter", "bowler"] } },
  { code: "LSG", name: "Lucknow Super Giants", short: "Lucknow", colors: ["#18a9b9", "#f04453"], personality: "specialist", strategy: { riskTolerance: 1.05, priceStretch: 1.02, focusRoles: ["wicketkeeper", "allrounder"] } }
];

export const CUSTOM_RULES = Object.freeze({
  purse: 12000,
  minSquad: 18,
  maxSquad: 25,
  maxOverseas: 8,
  minimumBid: 20,
  bidIncrement: 25,
  megaRetentionLimit: 3,
  miniRetentionLimit: 5,
  megaRetentionCosts: [1800, 1400, 1100],
  miniRetentionCosts: [1800, 1400, 1100, 900, 700],
  rtmEnabled: false,
  rtmLimitPerFranchise: 1,
  rtmWindowMs: 6000,
  currencyUnit: "lakh"
});

export function createFranchiseState() {
  return Object.fromEntries(FRANCHISES.map((team) => [team.code, {
    code: team.code,
    purse: CUSTOM_RULES.purse,
    squad: [],
    history: [],
    retention: {
      franchiseId: team.code,
      retainedPlayers: [],
      retainedPlayerIds: [],
      retainedPlayerNames: [],
      slotsUsed: 0,
      totalCost: 0,
      remainingPurse: CUSTOM_RULES.purse,
      finalSquadPlayerIds: [],
      releasedPlayerIds: [],
      releasedPlayers: [],
      advisorRecommendations: [],
      configuredLimit: CUSTOM_RULES.megaRetentionLimit,
      pricingMethod: "configured custom simulation slot costs"
    },
    personality: team.personality,
    strategy: team.strategy,
    needs: { batter: 5, wicketkeeper: 2, allrounder: 4, bowler: 7 }
  }]));
}
