function verifiedFranchiseCode(player) {
  if (player.season2026AssociationStatus === "verified" && player.season2026FranchiseCode) {
    return player.season2026FranchiseCode;
  }
  if (player.originalFranchiseStatus === "verified" && player.originalFranchiseCode) {
    return player.originalFranchiseCode;
  }
  if (player.previousFranchiseStatus === "verified" && player.previousFranchiseCode) {
    return player.previousFranchiseCode;
  }
  return "";
}

function verifiedStat(player, stat) {
  const seasonValue = player.statistics?.ipl2025?.batting?.[stat] ?? player.statistics?.ipl2025?.bowling?.[stat];
  if (Number.isFinite(seasonValue)) return seasonValue;
  const value = player.statsVerified === true ? player.historicalStats?.[stat] : null;
  return Number.isFinite(value) ? value : null;
}

function matchesRange(value, minimum, maximum) {
  if (minimum === "" && maximum === "") return true;
  return Number.isFinite(value) &&
    (minimum === "" || value >= Number(minimum)) &&
    (maximum === "" || value <= Number(maximum));
}

export function filterCatalogue(players, filters = {}, getStatus = () => "eligible") {
  const query = String(filters.query ?? "").trim().toLocaleLowerCase();
  const sortBy = filters.sort ?? "name";
  const filtered = players.filter((player) => {
    const status = getStatus(player);
    const capped = player.cappedStatus === "verified" && typeof player.capped === "boolean"
      ? player.capped ? "capped" : "uncapped"
      : "unknown";
    return (!query || [player.name, ...(player.aliases ?? [])]
      .some((name) => name.toLocaleLowerCase().includes(query))) &&
      (!filters.franchise || verifiedFranchiseCode(player) === filters.franchise) &&
      (!filters.nationality || player.nationalityGroup === filters.nationality) &&
      (!filters.role || player.role === filters.role) &&
      (!filters.category || player.category === filters.category) &&
      (!filters.capped || capped === filters.capped) &&
      (!filters.status || status === filters.status) &&
      matchesRange(player.basePrice, filters.minimumPrice ?? "", filters.maximumPrice ?? "") &&
      matchesRange(player.rating, filters.minimumRating ?? "", filters.maximumRating ?? "");
  });
  const accessors = {
    name: (player) => player.name.toLocaleLowerCase(),
    basePrice: (player) => player.basePrice,
    rating: (player) => player.rating,
    runs: (player) => verifiedStat(player, "runs"),
    wickets: (player) => verifiedStat(player, "wickets"),
    strikeRate: (player) => verifiedStat(player, "strikeRate")
  };
  const accessor = accessors[sortBy] ?? accessors.name;
  return filtered.sort((a, b) => {
    const first = accessor(a);
    const second = accessor(b);
    if (first == null && second != null) return 1;
    if (second == null && first != null) return -1;
    if (first < second) return -1;
    if (first > second) return 1;
    return a.id.localeCompare(b.id);
  });
}

export function verifiedFranchiseForCatalogue(player) {
  return verifiedFranchiseCode(player) || "N/A";
}

export function verifiedStatForCatalogue(player, stat) {
  return verifiedStat(player, stat);
}
