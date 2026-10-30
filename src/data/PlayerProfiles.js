import { VERIFIED_STAT_RECORDS } from "./verifiedStats.js";

const IPL_CAREER_CUTOFF = "2025-06-03";

const BATTING_FIELDS = [
  "matches", "innings", "runs", "average", "strikeRate", "highestScore",
  "hundreds", "fifties", "fours", "sixes", "ducks"
];
const BOWLING_FIELDS = [
  "matches", "innings", "wickets", "overs", "runsConceded", "average",
  "economy", "strikeRate", "bestFigures", "fourWicketHauls", "fiveWicketHauls", "maidens"
];
const FIELDING_FIELDS = ["catches", "stumpings"];

const ROLE_BASELINES = Object.freeze({
  batter: 57,
  wicketkeeper: 55,
  allrounder: 56,
  bowler: 57,
  unknown: 50
});

const RATING_KEYS = Object.freeze([
  "batting", "bowling", "powerplayBatting", "middleOverBatting", "deathOverBatting", "finishing",
  "paceBowling", "spinBowling", "powerplayBowling", "middleOverBowling", "deathOverBowling",
  "fielding", "wicketkeeping", "allRoundAbility", "consistency", "overall"
]);

function emptyStatistics(period) {
  return {
    period,
    batting: Object.fromEntries(BATTING_FIELDS.map((field) => [field, null])),
    bowling: Object.fromEntries(BOWLING_FIELDS.map((field) => [field, null])),
    fielding: Object.fromEntries(FIELDING_FIELDS.map((field) => [field, null])),
    sources: [],
    fieldSources: {}
  };
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function confidenceFor(player, usedVerifiedEvidence) {
  if (!usedVerifiedEvidence && player.role === "unknown") return "very low";
  return "low";
}

function relevantMissingFields(statistics, player) {
  const sections = player.role === "bowler" ? ["bowling"] :
    player.role === "wicketkeeper" ? ["batting", "fielding"] :
      player.role === "allrounder" ? ["batting", "bowling"] : ["batting"];
  return sections.flatMap((section) => Object.entries(statistics[section])
    .filter(([, value]) => value === null)
    .map(([field]) => `${section}.${field}`));
}

function ratingFor(player, statistics, key, hasVerifiedData) {
  const baseline = ROLE_BASELINES[player.role] ?? ROLE_BASELINES.unknown;
  const variation = (stableHash(`${player.name}:${key}`) % 17) - 8;
  let evidenceAdjustment = 0;
  const evidence = [`${player.roleStatus ?? "role unavailable"}`, "role-based simulation prior", "stable-name deterministic variation"];
  const battingRuns = statistics.batting.runs;
  const wickets = statistics.bowling.wickets;
  if (["batting", "overall"].includes(key) && battingRuns !== null) {
    evidenceAdjustment += Math.min(7, battingRuns / 110);
    const source = statistics.fieldSources["batting.runs"];
    evidence.push(`verified IPL 2025 runs: ${battingRuns} (${source?.name ?? "source unavailable"}; ${source?.url ?? "N/A"})`);
  }
  if (["bowling", "overall"].includes(key) && wickets !== null) {
    evidenceAdjustment += Math.min(7, wickets / 4);
    const source = statistics.fieldSources["bowling.wickets"];
    evidence.push(`verified IPL 2025 wickets: ${wickets} (${source?.name ?? "source unavailable"}; ${source?.url ?? "N/A"})`);
  }
  const roleMatches = {
    batting: ["batter", "wicketkeeper", "allrounder"],
    bowling: ["bowler", "allrounder"],
    powerplayBatting: ["batter", "wicketkeeper", "allrounder"],
    middleOverBatting: ["batter", "wicketkeeper", "allrounder"],
    deathOverBatting: ["batter", "wicketkeeper", "allrounder"],
    finishing: ["batter", "wicketkeeper", "allrounder"],
    paceBowling: ["bowler", "allrounder"],
    spinBowling: ["bowler", "allrounder"],
    powerplayBowling: ["bowler", "allrounder"],
    middleOverBowling: ["bowler", "allrounder"],
    deathOverBowling: ["bowler", "allrounder"],
    fielding: ["batter", "wicketkeeper", "allrounder", "bowler"],
    wicketkeeping: ["wicketkeeper"],
    allRoundAbility: ["allrounder"],
    consistency: ["batter", "wicketkeeper", "allrounder", "bowler"],
    overall: ["batter", "wicketkeeper", "allrounder", "bowler"]
  };
  const roleAdjustment = roleMatches[key]?.includes(player.role) ? 5 : -5;
  const value = Math.max(25, Math.min(82, Math.round(baseline + variation + roleAdjustment + evidenceAdjustment)));
  return {
    value,
    status: evidence.length > 3 ? "verified-data-derived" : "estimated",
    evidence,
    confidence: confidenceFor(player, evidence.length > 3),
    missingFields: relevantMissingFields(statistics, player)
  };
}

function addVerifiedStatRecords(statistics, playerName) {
  const records = VERIFIED_STAT_RECORDS.filter((record) =>
    record.playerName === playerName && record.period === "ipl2025"
  );
  for (const record of records) {
    const source = {
      name: record.source.name,
      url: record.source.url,
      period: "IPL 2025, completed 2025-06-03",
      cutoff: record.source.cutoff,
      verifiedAt: record.source.verifiedAt
    };
    statistics[record.section][record.field] = record.value;
    statistics.fieldSources[`${record.section}.${record.field}`] = source;
    if (!statistics.sources.some((item) => item.url === source.url)) statistics.sources.push(source);
  }
}

export function validateVerifiedStatRecords(records, players) {
  const errors = [];
  const identities = new Set(players.map((player) => player.name));
  const seen = new Set();
  const allowedFields = {
    batting: new Set(BATTING_FIELDS),
    bowling: new Set(BOWLING_FIELDS),
    fielding: new Set(FIELDING_FIELDS)
  };
  if (!Array.isArray(records)) return ["Verified statistics source must be an array."];
  for (const record of records) {
    const key = `${record?.playerName}:${record?.period}:${record?.section}:${record?.field}`;
    if (!record || typeof record !== "object") {
      errors.push("Verified statistics source contains a malformed record.");
      continue;
    }
    if (!identities.has(record.playerName)) errors.push(`Unknown canonical player identity: ${record.playerName}`);
    if (!Object.hasOwn(allowedFields, record.section) || !allowedFields[record.section].has(record.field)) {
      errors.push(`Unsupported statistic field: ${record.section}.${record.field}`);
    }
    if (!/^ipl20(?:24|25)$/.test(record.period ?? "")) errors.push(`Unsupported statistics period: ${record.period}`);
    if (!Number.isFinite(record.value) || record.value < 0) errors.push(`Invalid statistic value for ${key}`);
    if (seen.has(key)) errors.push(`Duplicate verified statistic record: ${key}`);
    seen.add(key);
    const source = record.source;
    if (!source?.name || !/^https:\/\//.test(source.url ?? "") ||
        !/^\d{4}-\d{2}-\d{2}$/.test(source.cutoff ?? "") ||
        !/^\d{4}-\d{2}-\d{2}$/.test(source.verifiedAt ?? "")) {
      errors.push(`Missing source, cutoff, or verifiedAt metadata for ${key}`);
    }
  }
  return errors;
}

function allMissingFields(statistics) {
  const missingStatistics = Object.entries(statistics).flatMap(([period, record]) =>
    ["batting", "bowling", "fielding"].flatMap((section) =>
      Object.entries(record[section]).filter(([, value]) => value === null)
        .map(([field]) => `${period}.${section}.${field}`)
    )
  );
  return statistics.domestic.competition === null
    ? [...missingStatistics, "domestic.competition"]
    : missingStatistics;
}

export function buildPlayerProfile(player) {
  const ipl2024 = emptyStatistics("IPL 2024: not researched");
  const iplCareer = emptyStatistics(`IPL career through ${IPL_CAREER_CUTOFF}`);
  const ipl2025 = emptyStatistics("IPL 2025, completed 2025-06-03");
  const otherT20Career = emptyStatistics("Other T20 career: not researched");
  const domestic = {
    ...emptyStatistics("Domestic competition records: not researched"),
    competition: null
  };
  addVerifiedStatRecords(ipl2025, player.name);
  const statistics = { ipl2024, iplCareer, ipl2025, otherT20Career, domestic };
  const ratingsFor = (period) => {
    const hasVerifiedStats = Object.keys(period.fieldSources).length > 0;
    return Object.fromEntries(RATING_KEYS.map((key) => [
      key,
      ratingFor(player, period, key, hasVerifiedStats)
    ]));
  };
  const simulationRatingsByAuctionSeason = {
    2025: ratingsFor(ipl2024),
    2026: ratingsFor(ipl2025)
  };
  const simulationRatings = simulationRatingsByAuctionSeason[2026];
  const hasVerifiedStats = Object.values(statistics).some((period) => Object.keys(period.fieldSources).length > 0);
  const missingFields = allMissingFields(statistics);
  return {
    ...player,
    statistics,
    simulationRatings,
    simulationRatingsByAuctionSeason,
    missingFields,
    dataConfidence: hasVerifiedStats ? "low" : player.role === "unknown" ? "very low" : "low",
    statsVerified: hasVerifiedStats,
    historicalStats: null,
    rating: simulationRatings.overall.value,
    ratingLabel: "Estimated simulation rating; not an official statistic"
  };
}

export function buildPlayerDataCoverage(players) {
  const importedPlayers = players.filter((player) => player.seedFranchiseCodes?.length > 0);
  const verified = importedPlayers.filter((player) => player.statsVerified === true);
  const byRole = (role) => verified.filter((player) => player.role === role).length;
  const simulationOnly = importedPlayers.filter((player) =>
    !player.statsVerified && player.role !== "unknown"
  ).length;
  const insufficient = importedPlayers.filter((player) =>
    !player.statsVerified && player.role === "unknown"
  ).length;
  return {
    totalUniquePlayers: importedPlayers.length,
    totalCatalogueRecords: players.length,
    verifiedProfiles: verified.length,
    partialProfiles: verified.filter((player) => player.missingFields.length > 0).length,
    completeProfiles: verified.filter((player) => player.missingFields.length === 0).length,
    verifiedByRole: {
      batters: byRole("batter"),
      bowlers: byRole("bowler"),
      allrounders: byRole("allrounder"),
      wicketkeepers: byRole("wicketkeeper")
    },
    verifiedIPL2025: importedPlayers.filter((player) => Object.keys(player.statistics.ipl2025.fieldSources).length > 0).length,
    verifiedIPLCareer: importedPlayers.filter((player) => Object.keys(player.statistics.iplCareer.fieldSources).length > 0).length,
    verifiedOtherT20: importedPlayers.filter((player) => Object.keys(player.statistics.otherT20Career.fieldSources).length > 0).length,
    verifiedDomestic: importedPlayers.filter((player) => Object.keys(player.statistics.domestic.fieldSources).length > 0).length,
    simulationEstimatesOnly: simulationOnly,
    insufficientData: insufficient
  };
}

export function hasVerifiedStatistics(period) {
  return Object.keys(period?.fieldSources ?? {}).length > 0;
}

export function statisticsForAuctionSeason(player, auctionSeason) {
  if (![2025, 2026].includes(Number(auctionSeason))) return null;
  return player.statistics?.[`ipl${Number(auctionSeason) - 1}`] ?? null;
}

export function ratingsForAuctionSeason(player, auctionSeason) {
  return player.simulationRatingsByAuctionSeason?.[Number(auctionSeason)] ?? player.simulationRatings ?? {};
}