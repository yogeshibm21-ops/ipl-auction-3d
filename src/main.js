import { AuctionEngine, GAME_STATES } from "./game/AuctionEngine.js";
import { FRANCHISES, CUSTOM_RULES } from "./data/franchises.js";
import { PLAYERS, validatePlayers } from "./data/players.js";
import { buildPlayerDataCoverage, statisticsForAuctionSeason } from "./data/PlayerProfiles.js";
import { AuctionHall } from "./three/AuctionHall.js";
import { AuctioneerDirector } from "./auctioneer/AuctioneerDirector.js";
import { AuctionClock, finalCallStageDurations, normalizeFinalCallDuration } from "./game/AuctionClock.js";
import { buildTeamsAfterRetention, createSampleHistory, recommendFranchiseRetentions, retentionCosts, retentionLimit, retentionCost } from "./game/RetentionRules.js";
import { filterCatalogue, verifiedFranchiseForCatalogue, verifiedStatForCatalogue } from "./game/PlayerCatalogue.js";
import { plannedSpend, validateUserTargetPlan } from "./game/UserTargetPlan.js";
import { evaluatePlayerValue } from "./game/PlayerValuation.js";
import "./styles.css";

const SAVE_KEY = "ipl-auction-3d-save-v1";
const SETTINGS_KEY = "ipl-auction-3d-settings-v1";
const TARGET_PLAN_KEY = "ipl-auction-3d-target-plans-v1";
const app = document.querySelector("#app");
const dataErrors = validatePlayers();

if (dataErrors.length) {
  app.innerHTML = `<main class="fatal"><h1>Player data could not be loaded</h1><p>${escapeHtml(dataErrors.join("; "))}</p></main>`;
  throw new Error(dataErrors.join("; "));
}

const settings = loadSettings();
let engine = null;
let hall = null;
let aiTimer = null;
let aiClock = new AuctionClock();
let closeClock = new AuctionClock();
let aiCursor = 0;
let aiTeams = [];
let speaking = false;
let skipNotice = "";
let skipLockUntil = 0;
let activeTab = "auction";
let lastMessage = "Welcome to the auction floor.";
let pendingSetup = null;
let selectedCataloguePlayerId = null;
const catalogueFilters = {
  query: "",
  franchise: "",
  nationality: "",
  role: "",
  category: "",
  capped: "",
  status: "",
  minimumPrice: "",
  maximumPrice: "",
  minimumRating: "",
  maximumRating: "",
  sort: "name"
};
const DEBUG_AI = new URLSearchParams(location.search).get("debugAI") === "1";
const auctioneer = new AuctioneerDirector({
  onSubtitle: (line) => { lastMessage = line; },
  speak: (line, done) => speakLine(line, done),
  cancelSpeech: () => window.speechSynthesis?.cancel(),
  onComplete: (event) => {
    if (event.type === "auction-opening") {
      engine?.completeAuctionOpening();
    } else if (event.type === "player-presented") {
      engine?.openBidding(event.lotId, event.sessionId);
    } else if (event.type === "category-start" || event.type === "category-transition") {
      engine?.startLot();
    }
  }
});

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function formatMoney(lakh) {
  if (!Number.isFinite(lakh)) return "Unavailable";
  if (lakh >= 100) {
    const crore = Math.floor(lakh / 100);
    const remainder = lakh % 100;
    return `₹${crore}${remainder ? `.${String(remainder).padStart(2, "0")}` : ""} cr`;
  }
  return `₹${lakh} lakh`;
}

function formatProjectedBudget(lakh) {
  return lakh < 0 ? `Short by ${formatMoney(Math.abs(lakh))}` : formatMoney(lakh);
}

function formatVerifiedStats(player) {
  const statistics = player.statistics?.ipl2025;
  if (!statistics || !Object.keys(statistics.fieldSources ?? {}).length) return "No verified statistics; simulation estimates only";
  const fields = [["Runs", statistics.batting?.runs], ["Wickets", statistics.bowling?.wickets]]
    .filter(([, value]) => Number.isFinite(value));
  return `IPL 2025 verified ${fields.map(([label, value]) => `${label} ${value}`).join(" · ")}`;
}

function displayStat(value) {
  return value === null || value === undefined ? "N/A" : String(value);
}

function verifiedNationalityGroup(player) {
  const statusTokens = String(player.nationalityStatus ?? "").toLocaleLowerCase().split(/[^a-z]+/);
  return statusTokens.includes("verified") ? player.nationalityGroup : "N/A";
}

function verifiedCappedStatus(player) {
  if (player.cappedStatus !== "verified" || typeof player.capped !== "boolean") return "N/A";
  return player.capped ? "Capped" : "Uncapped";
}

function simulationOwnership(player) {
  const owner = FRANCHISES.find((team) => engine.teams[team.code]?.squad.some((item) => item.id === player.id));
  if (owner) return `Owned by ${owner.code} in this simulation`;
  if (player.releasedBy) return `Released by ${player.releasedBy} in this simulation (ownership unverified)`;
  return "Unassigned in this simulation";
}

function profileStatsForRole(player, period) {
  const statistics = period ?? {};
  const batting = statistics.batting ?? {};
  const bowling = statistics.bowling ?? {};
  const fielding = statistics.fielding ?? {};
  const battingFields = [["Matches", "matches"], ["Innings", "innings"], ["Runs", "runs"], ["Avg", "average"], ["SR", "strikeRate"], ["HS", "highestScore"], ["100s", "hundreds"], ["50s", "fifties"], ["4s", "fours"], ["6s", "sixes"]];
  const bowlingFields = [["Matches", "matches"], ["Innings", "innings"], ["Wickets", "wickets"], ["Overs", "overs"], ["Runs conceded", "runsConceded"], ["Avg", "average"], ["Economy", "economy"], ["SR", "strikeRate"], ["Best", "bestFigures"], ["4W", "fourWicketHauls"], ["5W", "fiveWicketHauls"], ["Maidens", "maidens"]];
  const entries = player.role === "bowler" ? [["Bowling", bowling, bowlingFields]] :
    player.role === "allrounder" ? [["Batting", batting, battingFields], ["Bowling", bowling, bowlingFields]] :
      player.role === "wicketkeeper" ? [["Batting", batting, battingFields], ["Keeping", fielding, [["Catches", "catches"], ["Stumpings", "stumpings"]]]] :
        player.role === "unknown" ? [["Batting", batting, battingFields], ["Bowling", bowling, bowlingFields]] :
          [["Batting", batting, battingFields]];
  return entries.map(([title, values, fields]) => `<div class="profile-stat-block"><b>${title}</b><p>${fields.map(([label, key]) => `${label} ${escapeHtml(displayStat(values[key]))}`).join(" · ")}</p></div>`).join("");
}

function relevantRatingKeys(role) {
  if (role === "unknown") return ["overall"];
  if (role === "bowler") return ["bowling", "paceBowling", "spinBowling", "powerplayBowling", "middleOverBowling", "deathOverBowling", "consistency", "fielding", "overall"];
  if (role === "allrounder") return ["batting", "bowling", "paceBowling", "spinBowling", "allRoundAbility", "consistency", "overall"];
  if (role === "wicketkeeper") return ["batting", "wicketkeeping", "fielding", "consistency", "overall"];
  return ["batting", "powerplayBatting", "middleOverBatting", "deathOverBatting", "finishing", "consistency", "overall"];
}

function renderAuctionProfile(player, team) {
  if (!player) return "";
  const period = statisticsForAuctionSeason(player, engine.auctionSeason);
  const evaluation = evaluatePlayerValue({
    player,
    team,
    teams: Object.values(engine.teams),
    remainingPlayers: engine.queue.slice(engine.index + 1),
    rules: CUSTOM_RULES
  });
  const ratings = relevantRatingKeys(player.role).map((key) => {
    const rating = player.simulationRatings?.[key];
    const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
    return `<span><b>${label}</b> ${rating?.value ?? "N/A"}<small>${rating?.status === "verified-data-derived" ? "data-derived" : "estimate"} · ${rating?.confidence ?? "N/A"}</small></span>`;
  }).join("");
  const sources = (period?.sources ?? []).map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.name)}</a>`).join(" · ") || "No verified source for this period";
  const positives = evaluation.positiveFactors.length ? evaluation.positiveFactors.join(" · ") : "No strong verified factors";
  const risks = evaluation.risks.length ? evaluation.risks.join(" · ") : "No material profile risks recorded";
  return `<section class="auction-profile" aria-label="Current player statistical profile">
    <div class="profile-heading"><div><small>PLAYER PROFILE · IPL ${engine.auctionSeason - 1} PRE-AUCTION STATS</small><h3>${escapeHtml(player.name)} · ${escapeHtml(player.role)}</h3></div><span>${escapeHtml(evaluation.confidence)} confidence</span></div>
    <div class="profile-stat-grid">${profileStatsForRole(player, period)}</div>
    <p class="profile-source"><b>IPL ${engine.auctionSeason - 1}</b> · ${escapeHtml(period?.period ?? "N/A")} · ${sources}</p>
    <p class="profile-factors">Nationality group ${escapeHtml(verifiedNationalityGroup(player))} · Capped status ${escapeHtml(verifiedCappedStatus(player))} · ${escapeHtml(simulationOwnership(player))}</p>
    <div class="profile-rating-grid">${ratings}</div>
    <div class="profile-value-row"><span>Estimated value ${formatMoney(evaluation.valueRange.minimum)}–${formatMoney(evaluation.valueRange.maximum)}</span><b>Suggested limit ${formatMoney(evaluation.recommendedBidLimit)}</b></div>
    <p class="profile-factors"><b>Role source:</b> ${escapeHtml(player.roleStatus ?? "N/A")}</p>
    <p class="profile-factors"><b>Value factors:</b> ${escapeHtml(positives)}</p><p class="profile-factors"><b>Risks:</b> ${escapeHtml(risks)}</p>
    <details class="profile-missing"><summary>Missing data · ${player.missingFields?.length ?? "N/A"} fields</summary><p>${escapeHtml((player.missingFields ?? []).join(" · ") || "None")}</p></details>
  </section>`;
}

function renderAuctionQuickFacts(player, team) {
  if (!player) return "";
  const season = statisticsForAuctionSeason(player, engine.auctionSeason);
  const batting = season?.batting ?? {};
  const bowling = season?.bowling ?? {};
  const fielding = season?.fielding ?? {};
  const battingSummary = `Runs ${displayStat(batting.runs)} · Avg ${displayStat(batting.average)} · SR ${displayStat(batting.strikeRate)}`;
  const bowlingSummary = `Wkts ${displayStat(bowling.wickets)} · Econ ${displayStat(bowling.economy)} · Avg ${displayStat(bowling.average)}`;
  const stats = player.role === "bowler" ? bowlingSummary :
    player.role === "allrounder" ? `${battingSummary}<br>${bowlingSummary}` :
      player.role === "wicketkeeper" ? `${battingSummary}<br>Catches ${displayStat(fielding.catches)} · Stumpings ${displayStat(fielding.stumpings)}` :
        player.role === "unknown" ? `${battingSummary}<br>${bowlingSummary}` : battingSummary;
  const ratingKeys = player.role === "bowler" ? ["bowling", "powerplayBowling", "deathOverBowling"] :
    player.role === "allrounder" ? ["batting", "bowling", "allRoundAbility"] :
      player.role === "wicketkeeper" ? ["batting", "wicketkeeping"] :
        player.role === "unknown" ? ["overall"] : ["batting", "finishing"];
  const ratings = ratingKeys.map((key) => {
    const record = player.simulationRatings?.[key];
    return `${key.replace(/([A-Z])/g, " $1")}: ${record?.value ?? "N/A"} (${record?.status === "verified-data-derived" ? "derived" : "estimate"})`;
  }).join(" · ");
  const evaluation = evaluatePlayerValue({
    player,
    team,
    teams: Object.values(engine.teams),
    remainingPlayers: engine.queue.slice(engine.index + 1),
    rules: CUSTOM_RULES
  });
  return `<div class="scene-profile-quick"><small>IPL ${engine.auctionSeason - 1} · ${escapeHtml(evaluation.confidence)} confidence</small><p>${stats}</p><p>${escapeHtml(ratings)}</p><b>${formatMoney(evaluation.valueRange.minimum)}–${formatMoney(evaluation.valueRange.maximum)} estimated · limit ${formatMoney(evaluation.recommendedBidLimit)}</b></div>`;
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      voice: saved.voice === true,
      subtitles: saved.subtitles !== false,
      sound: saved.sound !== false,
      voiceVolume: saved.voiceVolume ?? 0.85,
      voiceRate: saved.voiceRate ?? 0.88,
      finalCallDurationSeconds: normalizeFinalCallDuration(saved.finalCallDurationSeconds),
      resultDisplaySeconds: Math.max(2, Math.min(3, Number(saved.resultDisplaySeconds) || 2.5)),
      quality: saved.quality ?? "standard"
    };
  } catch {
    return { voice: false, subtitles: true, sound: true, voiceVolume: 0.85, voiceRate: 0.88, finalCallDurationSeconds: 7, resultDisplaySeconds: 2.5, quality: "standard" };
  }
}

function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function renderSetup(message = "") {
  clearTimers();
  auctioneer.clear();
  speaking = false;
  hall?.dispose();
  hall = null;
  app.innerHTML = `
    <main class="setup-screen">
      <div class="setup-backdrop"></div>
      <section class="setup-card">
        <div class="brand"><span class="brand-mark">3D</span><span>FRANCHISE AUCTION SIMULATOR</span></div>
        <p class="eyebrow">UNOFFICIAL FAN-MADE SIMULATOR</p>
        <h1>IPL AUCTION <em>3D</em></h1>
        <p class="tagline">BID SMART. BUILD STRONG. WIN THE CUP.</p>
        <p class="intro">Take your seat at the table. Build a balanced squad against nine rival franchises in a live, 3D auction hall.</p>
        <div class="setup-grid">
          <label>Choose your franchise
            <select id="team-select">${FRANCHISES.map((team) => `<option value="${team.code}">${team.name} (${team.code})</option>`).join("")}</select>
          </label>
          <label>Auction format
            <select id="mode-select"><option>Mega Auction</option><option>Mini Auction</option><option>Custom Auction</option></select>
          </label>
          <label>Auction season
            <select id="season-select"><option value="2025">2025</option><option value="2026" selected>2026</option></select>
          </label>
          <label>AI challenge
            <select id="difficulty-select"><option>Easy</option><option selected>Normal</option><option>Hard</option></select>
          </label>
          <label>Auction pace
            <select id="pacing-select"><option selected>Relaxed</option><option>Standard</option><option>Fast</option></select>
          </label>
          <label>Queue order
            <select id="random-select"><option value="true" selected>Shuffle within sets</option><option value="false">Use custom set order</option></select>
          </label>
          <label class="setup-toggle"><input id="rtm-enabled" type="checkbox" ${CUSTOM_RULES.rtmEnabled ? "checked" : ""}> Enable optional RTM simulation</label>
        </div>
        <p class="rules-note">Review seed-list players for all ten franchises before the auction. Seed associations are unverified simulation inputs, not official season squads.</p>
        <p class="rules-note">Custom game defaults: ₹120 cr purse · 18–25 squad · max 8 overseas. Mega/Mini retention costs are configurable simulation rules.</p>
        <div class="setup-actions"><button id="start-btn" class="button button-primary">Start new auction <span>→</span></button><button id="resume-btn" class="button button-secondary">Resume saved game</button></div>
        <p class="warning">${escapeHtml(message)}</p>
        <p class="fine-print">Independent fan project. Not affiliated with or endorsed by the IPL or its franchises. Player ratings and auction values are simulated; historical eligibility is not asserted.</p>
      </section>
      <div class="setup-foot"><span>THREE.JS · LOCAL SAVE · NO ACCOUNT REQUIRED</span><span>${PLAYERS.length} PLAYER RECORDS</span></div>
    </main>`;

  const resumeButton = document.querySelector("#resume-btn");
  resumeButton.disabled = !localStorage.getItem(SAVE_KEY);
  resumeButton.addEventListener("click", resumeAuction);
  document.querySelector("#start-btn").addEventListener("click", () => {
    const team = document.querySelector("#team-select").value;
    const mode = document.querySelector("#mode-select").value;
    const difficulty = document.querySelector("#difficulty-select").value;
    const randomized = document.querySelector("#random-select").value === "true";
    const seed = Math.floor(Math.random() * 0xffffffff);
    const options = {
      team, mode, difficulty, randomized, seed,
      auctionSeason: Number(document.querySelector("#season-select").value),
      rtmEnabled: document.querySelector("#rtm-enabled").checked,
      rtmLimit: CUSTOM_RULES.rtmLimitPerFranchise,
      customRetentionLimit: CUSTOM_RULES.megaRetentionLimit,
      pacing: document.querySelector("#pacing-select").value
    };
    pendingSetup = options;
    renderRetentionSetup(options);
  });
}

function renderRetentionSetup(options) {
  let limit = retentionLimit(options.mode, options.customRetentionLimit);
  const sampleHistory = options.sampleHistory ?? createSampleHistory(PLAYERS, { auctionSeason: options.auctionSeason });
  options.sampleHistory = sampleHistory;
  options.retentionAdvice = options.retentionAdvice ?? recommendFranchiseRetentions({
    sampleHistory,
    mode: options.mode,
    userTeam: options.team,
    auctionSeason: options.auctionSeason,
    customRetentionLimit: options.customRetentionLimit
  });
  const retainedByTeam = options.retainedIdsByTeam ?? Object.fromEntries(FRANCHISES.map(({ code }) => [
    code,
    code === options.team ? [...(options.userRetainedIds ?? [])] : [...(options.retentionAdvice[code]?.retainedIds ?? [])]
  ]));
  options.retainedIdsByTeam = retainedByTeam;
  let activeTeam = options.team;
  let listView = "all";
  let undoStack = [];
  let warning = "";

  const render = () => {
    const activeFranchise = FRANCHISES.find(({ code }) => code === activeTeam);
    const candidates = sampleHistory[activeTeam] ?? [];
    const retained = retainedByTeam[activeTeam] ?? [];
    const visibleCandidates = candidates.filter((player) =>
      listView === "all" || (retained.includes(player.id) ? "retained" : "released") === listView
    );
    const review = FRANCHISES.map((team) => {
      const selected = retainedByTeam[team.code] ?? [];
      const releases = (sampleHistory[team.code] ?? []).filter((player) =>
        !selected.includes(player.id) && !FRANCHISES.some((other) =>
          (retainedByTeam[other.code] ?? []).includes(player.id)
        )
      );
      const cost = retentionCost(options.mode, selected.length, options.customRetentionLimit);
      return `<article class="retention-review" style="--team-accent:${team.colors[0]}"><b>${escapeHtml(team.code)} · ${escapeHtml(team.name)}</b><span>${selected.length}/${limit} retained</span><span>Cost ${formatMoney(cost)}</span><span>Purse ${formatMoney(CUSTOM_RULES.purse - cost)}</span><span>${releases.length} released · ${releases.filter((player) => Number.isInteger(player.basePrice)).length} priced for auction</span></article>`;
    }).join("");
    app.innerHTML = `<main class="setup-screen"><section class="setup-card retention-card retention-workspace">
      <p class="eyebrow">CUSTOM SIMULATION · ${escapeHtml(options.mode.toUpperCase())}</p><h1>Franchise <em>retention desk</em></h1>
      <p class="intro">Review each franchise's supplied seed list. These lists are unverified historical associations, not verified season squads. AI franchises start with role- and cost-aware retention recommendations; all decisions can be changed here. Retained players stay attached to their franchise; released players enter the queue when priced for this simulation.</p>
      <p class="rules-note">Configured simulation retention costs: ${retentionCosts(options.mode, options.customRetentionLimit).map((cost, index) => `slot ${index + 1}: ${formatMoney(cost)}`).join(" · ")}. These are custom game costs, not official season rules or prices. Limit: ${limit} per franchise.${options.mode === "Custom Auction" ? ` Slots 4–5 use the configured Mini preset costs.` : ""}</p>
      ${options.mode === "Custom Auction" ? `<label class="retention-limit-control">Retention limit per franchise<select id="custom-retention-limit">${Array.from({ length: CUSTOM_RULES.miniRetentionLimit + 1 }, (_unused, count) => `<option value="${count}" ${count === limit ? "selected" : ""}>${count} player${count === 1 ? "" : "s"}</option>`).join("")}</select></label>` : ""}
      <nav class="retention-teams">${FRANCHISES.map((team) => `<button class="retention-team ${team.code === activeTeam ? "active" : ""}" data-franchise="${team.code}" style="--team-accent:${team.colors[0]}">${team.code}<small>${(sampleHistory[team.code] ?? []).length} seed records</small></button>`).join("")}</nav>
      <div class="retention-list-head"><div><small>${escapeHtml(activeFranchise.name)} · ${activeFranchise.code}</small><h2>Player decisions</h2></div><div class="retention-filter">${["all", "retained", "released"].map((filter) => `<button data-list-view="${filter}" class="${filter === listView ? "active" : ""}">${filter}</button>`).join("")}</div></div>
      <div class="retention-list">${visibleCandidates.length ? visibleCandidates.map((player) => {
        const selected = retained.includes(player.id);
        const retainedElsewhere = FRANCHISES.some((team) =>
          team.code !== activeTeam && (retainedByTeam[team.code] ?? []).includes(player.id)
        );
        const status = selected ? "Retained" : retainedElsewhere ? "Retained by another franchise" :
          Number.isInteger(player.basePrice) ? "Released · available to configured auction pool" : "Released · excluded: no configured base price";
        const role = player.role && player.role !== "unknown" ? player.role : "Role unavailable";
        const overseas = verifiedNationalityGroup(player) === "N/A" ? "Nationality group unverified" : player.isOverseas ? "Overseas" : "Domestic";
        const association = player.season2026AssociationStatus === "verified"
          ? `Verified 2026 association: ${player.season2026FranchiseCode}`
          : `Seed association: ${activeTeam} (unverified)`;
        const stats = player.statsVerified === true ? formatVerifiedStats(player) : "No verified statistics; estimate only";
        const aiRecommendation = options.retentionAdvice[activeTeam]?.decisions.find((item) => item.playerId === player.id);
        const slot = selected ? retained.indexOf(player.id) + 1 : 0;
        const configuredCost = slot ? retentionCosts(options.mode, options.customRetentionLimit)[slot - 1] : null;
        return `<article class="retention-option"><span class="player-initials small">${escapeHtml(player.name.split(" ").map((part) => part[0]).slice(0, 2).join(""))}</span><span class="retention-player"><b>${escapeHtml(player.name)}</b><small>${escapeHtml(role)} · ${escapeHtml(overseas)} · ${escapeHtml(association)}</small><small>${escapeHtml(stats)} · ${escapeHtml(status)}${slot ? ` · slot ${slot} cost ${formatMoney(configuredCost)}` : ""}</small>${aiRecommendation ? `<small class="retention-reason">AI recommendation: ${escapeHtml(aiRecommendation.reasons.join("; "))}</small>` : ""}</span><button class="button button-quiet" data-player-action="${selected ? "release" : "retain"}" data-player-id="${escapeHtml(player.id)}" ${retainedElsewhere ? "disabled" : ""}>${selected ? "Release" : "Retain"}</button></article>`;
      }).join("") : `<p class="empty-state">No players in this view.</p>`}</div>
      <div class="retention-summary"><span>Retained <b>${retained.length}/${limit}</b></span><span>Cost <b>${formatMoney(retentionCost(options.mode, retained.length, options.customRetentionLimit))}</b></span><span>Remaining purse <b>${formatMoney(CUSTOM_RULES.purse - retentionCost(options.mode, retained.length, options.customRetentionLimit))}</b></span><button id="undo-retention" class="button button-secondary" ${undoStack.length ? "" : "disabled"}>Undo selection</button></div>
      <section class="retention-review-list"><div class="section-heading"><div><small>FINAL REVIEW</small><h2>All ten franchise decisions</h2></div></div>${review}</section>
      <div class="setup-actions"><button id="confirm-retention" class="button button-primary">Confirm all decisions &amp; continue →</button><button id="retention-back" class="button button-secondary">Back</button></div>
      <p id="retention-warning" class="warning">${escapeHtml(warning)}</p>
    </section></main>`;

    document.querySelectorAll("[data-franchise]").forEach((button) => button.addEventListener("click", () => {
      activeTeam = button.dataset.franchise;
      render();
    }));
    document.querySelector("#custom-retention-limit")?.addEventListener("change", (event) => {
      options.customRetentionLimit = Number(event.target.value);
      limit = retentionLimit(options.mode, options.customRetentionLimit);
      warning = FRANCHISES.some((team) =>
        (retainedByTeam[team.code] ?? []).length > limit
      ) ? "One or more franchises exceed the new limit. Release players before confirming." : "";
      render();
    });
    document.querySelectorAll("[data-list-view]").forEach((button) => button.addEventListener("click", () => {
      listView = button.dataset.listView;
      render();
    }));
    document.querySelectorAll("[data-player-action]").forEach((button) => button.addEventListener("click", () => {
      const playerId = button.dataset.playerId;
      const selected = retainedByTeam[activeTeam] ?? [];
      if (button.dataset.playerAction === "retain") {
        if (selected.length >= limit) {
          warning = `${activeFranchise.name} has reached the ${limit}-player limit.`;
          render();
          return;
        }
        if (FRANCHISES.some((team) => team.code !== activeTeam && (retainedByTeam[team.code] ?? []).includes(playerId))) {
          warning = "A player can only be retained by one franchise in this simulation.";
          render();
          return;
        }
        undoStack.push({ team: activeTeam, previous: [...selected] });
        retainedByTeam[activeTeam] = [...selected, playerId];
      } else {
        undoStack.push({ team: activeTeam, previous: [...selected] });
        retainedByTeam[activeTeam] = selected.filter((id) => id !== playerId);
      }
      warning = "";
      render();
    }));
    document.querySelector("#undo-retention").addEventListener("click", () => {
      const previous = undoStack.pop();
      if (!previous) return;
      retainedByTeam[previous.team] = previous.previous;
      activeTeam = previous.team;
      warning = "";
      render();
    });
    document.querySelector("#retention-back").addEventListener("click", () => renderSetup());
    document.querySelector("#confirm-retention").addEventListener("click", () => {
      try {
        const retention = buildTeamsAfterRetention({
          mode: options.mode,
          sampleHistory,
          userTeam: options.team,
          retainedIdsByTeam: retainedByTeam,
          retentionAdvice: options.retentionAdvice,
          auctionSeason: options.auctionSeason,
          customRetentionLimit: options.customRetentionLimit
        });
        options.retainedIdsByTeam = retainedByTeam;
        renderPreAuctionPlan({ ...options, startingTeams: retention.teams });
      } catch (error) {
        warning = error.message;
        render();
      }
    });
  };
  render();
}

function renderPreAuctionPlan(options) {
  const teamPurse = options.startingTeams?.[options.team]?.purse ?? CUSTOM_RULES.purse;
  const retainedIds = new Set(FRANCHISES.flatMap((team) =>
    (options.startingTeams?.[team.code]?.squad ?? [])
      .filter((player) => player.retained === true)
      .map((player) => player.id)
  ));
  const availablePlayers = PLAYERS.filter((player) =>
    !retainedIds.has(player.id) && Number.isInteger(player.basePrice) && player.basePrice <= teamPurse &&
    player.currentOwner == null && !["RETAINED", "SOLD", "UNSOLD"].includes(player.auctionStatus)
  );
  let targetPlan = options.userTargetPlan ?? [];
  let planWarning = "";
  if (!options.userTargetPlan) {
    try {
      const savedPlans = JSON.parse(localStorage.getItem(TARGET_PLAN_KEY) || "{}");
      targetPlan = savedPlans[options.team] ?? [];
    } catch (error) {
      planWarning = `Saved target plan could not be read: ${error.message}`;
      targetPlan = [];
    }
  }
  try {
    targetPlan = validateUserTargetPlan(targetPlan, PLAYERS, { retainedIds, purse: teamPurse });
  } catch (error) {
    planWarning = `Saved target plan needs editing: ${error.message}`;
    targetPlan = [];
  }
  const playerById = new Map(PLAYERS.map((player) => [player.id, player]));

  const persistPlan = () => {
    try {
      targetPlan = validateUserTargetPlan(targetPlan, PLAYERS, { retainedIds, purse: teamPurse });
      const savedPlans = JSON.parse(localStorage.getItem(TARGET_PLAN_KEY) || "{}");
      savedPlans[options.team] = targetPlan;
      localStorage.setItem(TARGET_PLAN_KEY, JSON.stringify(savedPlans));
      planWarning = "";
      return true;
    } catch (error) {
      planWarning = `Target plan was not saved: ${error.message}`;
      return false;
    }
  };

  const renderPlanRows = () => targetPlan.map((target, index) => {
    const player = playerById.get(target.playerId);
    return `<div class="plan-row" data-plan-index="${index}">
      <div class="plan-player"><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.role)} · ${player.isOverseas ? "Overseas" : "Indian"} · base ${formatMoney(player.basePrice)}</small></div>
      <label>Target tier<select data-plan-field="priority" data-index="${index}">${["primary", "secondary", "backup"].map((priority) => `<option value="${priority}" ${target.priority === priority ? "selected" : ""}>${priority}</option>`).join("")}</select></label>
      <label>Role priority<select data-plan-field="rolePriority" data-index="${index}">${[1, 2, 3, 4].map((priority) => `<option value="${priority}" ${target.rolePriority === priority ? "selected" : ""}>${priority}</option>`).join("")}</select></label>
      <label>Spend limit (lakh)<input data-plan-field="spendLimit" data-index="${index}" type="number" min="${player.basePrice}" max="${teamPurse}" value="${target.spendLimit}"></label>
      <div class="plan-actions"><button class="button button-quiet" data-move-target="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="Move target up">↑</button><button class="button button-quiet" data-move-target="${index}" data-direction="1" ${index === targetPlan.length - 1 ? "disabled" : ""} aria-label="Move target down">↓</button><button class="button button-quiet" data-remove-target="${index}">Remove</button></div>
    </div>`;
  }).join("");

  const renderCandidates = () => {
    const query = document.querySelector("#planner-search")?.value.trim().toLocaleLowerCase() ?? "";
    const role = document.querySelector("#planner-role")?.value ?? "";
    const candidates = availablePlayers.filter((player) =>
      !targetPlan.some((target) => target.playerId === player.id) &&
      (!query || `${player.name} ${player.role} ${player.category} ${player.nationalityGroup}`.toLocaleLowerCase().includes(query)) &&
      (!role || player.role === role)
    ).slice(0, 80);
    document.querySelector("#planner-candidates").innerHTML = candidates.length
      ? candidates.map((player) => `<button class="plan-candidate" data-add-target="${escapeHtml(player.id)}"><span><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.role)} · ${escapeHtml(player.category)} · ${player.isOverseas ? "Overseas" : "Indian"}</small></span><strong>${formatMoney(player.basePrice)}</strong><i>ADD</i></button>`).join("")
      : `<p class="empty-state">No eligible players match these filters.</p>`;
  };

  const renderPlanner = () => {
    const team = FRANCHISES.find((franchise) => franchise.code === options.team);
    const reserved = plannedSpend(targetPlan);
    app.innerHTML = `<main class="setup-screen"><section class="setup-card planner-card">
      <p class="eyebrow">PLAYER CATALOGUE · PRE-AUCTION WORKSPACE · ${escapeHtml(team.code)}</p><h1>Target <em>planner</em></h1>
      <p class="intro">Browse eligible players and build a private target list for ${escapeHtml(team.name)}. Retained players are excluded. Your preferred limits are in integer lakhs and do not override the live purse or auction rules.</p>
      <div class="planner-summary"><span>Available purse <b>${formatMoney(teamPurse)}</b></span><span>All target limits <b>${formatMoney(reserved)}</b></span><span>Projected remaining <b>${formatProjectedBudget(teamPurse - reserved)}</b></span></div>
      <section class="planner-section"><div class="section-heading"><div><small>YOUR TARGETS</small><h3>Priority plan</h3></div><span>${targetPlan.length} targets</span></div>
        <div class="plan-rows">${renderPlanRows() || `<p class="empty-state">No targets added yet. Search the eligible catalogue below.</p>`}</div>
      </section>
      <section class="planner-section"><div class="section-heading"><div><small>ELIGIBLE PLAYER POOL</small><h3>Browse targets</h3></div><span>${availablePlayers.length} eligible</span></div>
        <div class="planner-filters"><input id="planner-search" placeholder="Search name, role, category..." aria-label="Search eligible players"><select id="planner-role"><option value="">All roles</option>${["batter", "allrounder", "wicketkeeper", "bowler", "unknown"].map((role) => `<option value="${role}">${role}</option>`).join("")}</select></div>
        <div id="planner-candidates" class="planner-candidates"></div><p class="data-note">Search to browse beyond the first 80 matching players. Players already retained by any franchise cannot be planned as auction targets.</p>
      </section>
      <div class="setup-actions"><button id="confirm-plan" class="button button-primary">Save plan &amp; start auction →</button><button id="planner-back" class="button button-secondary">Back</button></div>
      <p id="planner-warning" class="warning">${escapeHtml(planWarning)}</p>
    </section></main>`;
    renderCandidates();

    document.querySelector("#planner-search").addEventListener("input", renderCandidates);
    document.querySelector("#planner-role").addEventListener("change", renderCandidates);
    document.querySelector("#planner-candidates").addEventListener("click", (event) => {
      const button = event.target.closest("[data-add-target]");
      if (!button) return;
      const player = playerById.get(button.dataset.addTarget);
      if (!player || retainedIds.has(player.id)) {
        planWarning = "Retained or unavailable players cannot be added to the target plan.";
        renderPlanner();
        return;
      }
      const sameRoleCount = targetPlan.filter((target) => playerById.get(target.playerId).role === player.role).length;
      targetPlan.push({
        playerId: player.id,
        priority: ["primary", "secondary", "backup"][Math.min(sameRoleCount, 2)],
        spendLimit: player.basePrice,
        rolePriority: Math.min(sameRoleCount + 1, 4),
        order: targetPlan.length
      });
      persistPlan();
      renderPlanner();
    });
    document.querySelector(".plan-rows").addEventListener("change", (event) => {
      const field = event.target.dataset.planField;
      if (!field) return;
      const index = Number(event.target.dataset.index);
      if (field === "spendLimit") targetPlan[index][field] = Number(event.target.value);
      else if (field === "rolePriority") targetPlan[index][field] = Number(event.target.value);
      else targetPlan[index][field] = event.target.value;
      persistPlan();
      renderPlanner();
    });
    document.querySelector(".plan-rows").addEventListener("input", (event) => {
      if (event.target.dataset.planField !== "spendLimit") return;
      const index = Number(event.target.dataset.index);
      targetPlan[index].spendLimit = Number(event.target.value);
      if (!persistPlan()) document.querySelector("#planner-warning").textContent = planWarning;
      const summary = document.querySelector(".planner-summary");
      summary.innerHTML = `<span>Available purse <b>${formatMoney(teamPurse)}</b></span><span>All target limits <b>${formatMoney(plannedSpend(targetPlan))}</b></span><span>Projected remaining <b>${formatProjectedBudget(teamPurse - plannedSpend(targetPlan))}</b></span>`;
    });
    document.querySelector(".plan-rows").addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove-target]");
      if (removeButton) {
        targetPlan.splice(Number(removeButton.dataset.removeTarget), 1);
      } else {
        const moveButton = event.target.closest("[data-move-target]");
        if (!moveButton) return;
        const index = Number(moveButton.dataset.moveTarget);
        const nextIndex = index + Number(moveButton.dataset.direction);
        if (nextIndex < 0 || nextIndex >= targetPlan.length) return;
        [targetPlan[index], targetPlan[nextIndex]] = [targetPlan[nextIndex], targetPlan[index]];
      }
      targetPlan = targetPlan.map((target, index) => ({ ...target, order: index }));
      persistPlan();
      renderPlanner();
    });
    document.querySelector("#confirm-plan").addEventListener("click", () => {
      if (!persistPlan()) {
        document.querySelector("#planner-warning").textContent = planWarning;
        return;
      }
      startGame({ ...options, userTargetPlan: targetPlan });
    });
    document.querySelector("#planner-back").addEventListener("click", () => {
      if (options.mode === "Custom Auction") renderSetup();
      else renderRetentionSetup(options);
    });
  };
  renderPlanner();
}

function clearTimers(pacing = pendingSetup?.pacing ?? engine?.pacing ?? "Relaxed") {
  aiClock.dispose();
  closeClock.dispose();
  aiClock = new AuctionClock({ pacing });
  closeClock = new AuctionClock({ pacing });
  aiCursor = 0;
  aiTeams = [];
  aiTimer = null;
}

function startGame(options) {
  skipLockUntil = 0;
  clearTimers(options.pacing ?? options.snapshot?.pacing ?? "Relaxed");
  auctioneer.clear();
  hall?.dispose();
  hall = null;
  if (!options.snapshot) localStorage.removeItem(SAVE_KEY);
  engine = new AuctionEngine({
    players: PLAYERS,
    userTeam: options.team,
    mode: options.mode,
    auctionSeason: options.auctionSeason ?? options.snapshot?.auctionSeason ?? 2026,
    customRetentionLimit: options.customRetentionLimit ?? options.snapshot?.customRetentionLimit ?? CUSTOM_RULES.megaRetentionLimit,
    rtmEnabled: options.rtmEnabled ?? options.snapshot?.rtmEnabled ?? CUSTOM_RULES.rtmEnabled,
    rtmLimit: options.rtmLimit ?? options.snapshot?.rtmLimit ?? CUSTOM_RULES.rtmLimitPerFranchise,
    difficulty: options.difficulty,
    randomized: options.randomized,
    seed: options.seed,
    pacing: options.pacing ?? options.snapshot?.pacing ?? "Relaxed",
    eligiblePlayers: options.snapshot
      ? options.snapshot.queueIds.map((id) => PLAYERS.find((player) => player.id === id)).filter(Boolean)
      : options.eligiblePlayers ?? PLAYERS,
    startingTeams: options.startingTeams ?? null,
    userTargetPlan: options.userTargetPlan ?? [],
    snapshot: options.snapshot ?? null
  });
  if (options.startingTeams) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(engine.snapshot()));
    } catch (error) {
      renderSetup(`Could not save confirmed retentions on this device: ${error.message}`);
      return;
    }
  }
  engine.subscribe(onAuctionEvent);
  engine.pacing = options.pacing ?? options.snapshot?.pacing ?? "Relaxed";
  aiClock.dispose();
  closeClock.dispose();
  aiClock = new AuctionClock({ pacing: engine.pacing });
  closeClock = new AuctionClock({ pacing: engine.pacing });
  activeTab = "auction";
  lastMessage = "Auctioneer: Welcome to the auction floor.";
  renderGame();
  if (engine.state === GAME_STATES.READY) engine.startAuction();
  else if (engine.state === GAME_STATES.INTRODUCING && !engine.isPaused) engine.replayPresentation();
  else if (engine.isLotActive()) {
    scheduleSettlement();
    beginAIAuctions();
  } else if (engine.state === GAME_STATES.RTM_PENDING && !engine.isPaused) {
    scheduleRTMResolution();
  } else if (!engine.isPaused && [GAME_STATES.SOLD, GAME_STATES.UNSOLD, GAME_STATES.SKIPPED].includes(engine.state)) {
    scheduleNextLot(engine.getCurrentLotId(), engine.lastResultSessionId);
  }
}

function resumeAuction() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(SAVE_KEY));
    startGame({ snapshot, team: snapshot.userTeam });
  } catch (error) {
    renderSetup(`Could not resume the saved auction: ${error.message}`);
  }
}

function saveAuction() {
  try {
    if ([GAME_STATES.GOING_ONCE, GAME_STATES.GOING_TWICE, GAME_STATES.FINAL_CALL].includes(engine.state)) {
      engine.setFinalCallRemaining(closeClock.remaining());
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(engine.snapshot()));
    announce("Auction saved on this device.");
    renderGame();
  } catch (error) {
    announce(`Save failed: ${error.message}`);
  }
}

function onAuctionEvent(event) {
  const franchiseNames = Object.fromEntries(FRANCHISES.map((franchise) => [franchise.code, franchise.name]));
  if (event.type === "bid") {
    engine.setFinalCallRemaining(null);
    hall?.setLeader(event.teamCode);
    scheduleSettlement();
  } else if (event.type === "player-presented") {
    hall?.setLeader(null);
  } else if (event.type === "bidding-open") {
    skipNotice = "";
    scheduleSettlement();
    beginAIAuctions();
  } else if (event.type === "pass") {
  } else if (event.type === "skipped") {
    hall?.setLeader(null);
    clearTimers();
    skipNotice = "Player skipped by user. Moving to the next player.";
    announce(skipNotice);
    auctioneer.clear();
    auctioneer.handle(event, franchiseNames);
    engine.nextLot(event.sessionId);
    renderGame();
    return;
  } else if (event.type === "rtm-offered") {
    clearAIActions();
    scheduleRTMResolution();
  } else if (event.type === "paused") {
    aiClock.pause();
    closeClock.pause();
    if ([GAME_STATES.GOING_ONCE, GAME_STATES.GOING_TWICE, GAME_STATES.FINAL_CALL].includes(engine.state)) {
      engine.setFinalCallRemaining(closeClock.remaining());
    }
    window.speechSynthesis?.pause();
  } else if (event.type === "resumed") {
    window.speechSynthesis?.resume();
    if (aiClock.pendingCount) aiClock.resume();
    else if (engine.isLotActive()) beginAIAuctions();
    if (closeClock.pendingCount) closeClock.resume();
    else if (engine.isLotActive()) {
      scheduleSettlement();
    }
    else if (engine.state === GAME_STATES.INTRODUCING && !auctioneer.activeItem && !auctioneer.queue.length) {
      engine.replayPresentation();
    } else if (engine.state === GAME_STATES.RTM_PENDING) {
      scheduleRTMResolution();
    } else if ([GAME_STATES.SOLD, GAME_STATES.UNSOLD, GAME_STATES.SKIPPED].includes(engine.state)) {
      scheduleNextLot(engine.getCurrentLotId(), engine.lastResultSessionId);
    }
  } else if (event.type === "going-once") {
  } else if (event.type === "going-twice") {
  } else if (event.type === "sold") {
    hall?.setLeader(event.teamCode);
    clearTimers();
    scheduleNextLot(event.lotId, event.sessionId);
  } else if (event.type === "unsold") {
    clearTimers();
    scheduleNextLot(event.lotId, event.sessionId);
  } else if (event.type === "complete") {
    clearTimers();
  } else if (event.type === "ai-decision" && !DEBUG_AI) {
    return;
  }
  auctioneer.handle(event, franchiseNames);
  renderGame();
}

function speakLine(message, done) {
  lastMessage = message;
  if (settings.subtitles) document.querySelector(".ticker-card p")?.replaceChildren(document.createTextNode(message));
  if (!settings.voice || !("speechSynthesis" in window)) {
    done();
    return;
  }
  const speechText = message;
  const utterance = new SpeechSynthesisUtterance(speechText);
  utterance.rate = settings.voiceRate;
  utterance.volume = settings.sound ? settings.voiceVolume : 0;
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find((voice) => /male/i.test(voice.name) && /en/i.test(voice.lang))
    ?? voices.find((voice) => /en/i.test(voice.lang))
    ?? null;
  utterance.onstart = () => {
    speaking = true;
    hall?.setSpeaking(true);
    document.querySelector(".auctioneer-avatar")?.classList.add("speaking");
  };
  let completed = false;
  let fallbackTimer;
  const complete = () => {
    if (completed) return;
    completed = true;
    clearTimeout(fallbackTimer);
    speaking = false;
    hall?.setSpeaking(false);
    document.querySelector(".auctioneer-avatar")?.classList.remove("speaking");
    done();
  };
  utterance.onend = complete;
  utterance.onerror = complete;
  fallbackTimer = setTimeout(() => {
      window.speechSynthesis.cancel();
      complete();
  }, Math.min(30000, Math.max(12000, speechText.length * 180)));
  try {
    window.speechSynthesis.speak(utterance);
  } catch {
    complete();
  }
}

function scheduleNextLot(lotId, sessionId) {
  const generation = closeClock.reset();
  closeClock.schedule(() => {
    if (engine?.isPaused) return;
    if (!engine?.currentPlayer || engine.getCurrentLotId() !== lotId ||
        ![GAME_STATES.SOLD, GAME_STATES.UNSOLD, GAME_STATES.SKIPPED].includes(engine.state)) return;
    engine.nextLot(sessionId);
  }, settings.resultDisplaySeconds * 1000, generation);
}

function announce(message) {
  lastMessage = message;
  document.querySelector(".ticker-card p")?.replaceChildren(document.createTextNode(message));
}

function scheduleSettlement() {
  const generation = closeClock.reset();
  const lotId = engine?.getCurrentLotId();
  const sessionId = engine?.activeSessionId;
  const stages = finalCallStageDurations(settings.finalCallDurationSeconds);
  if (engine?.state === GAME_STATES.FINAL_CALL) {
    scheduleFinal(lotId, sessionId, generation,
      engine.finalCallRemainingMs ?? stages.finalCallMs);
  } else if (engine?.state === GAME_STATES.GOING_TWICE) {
    scheduleFinalCall(lotId, sessionId, generation, engine.finalCallRemainingMs ?? stages.toFinalCallMs);
  } else if (engine?.state === GAME_STATES.GOING_ONCE) {
    scheduleTwice(lotId, sessionId, generation, engine.finalCallRemainingMs ?? stages.toGoingTwiceMs);
  } else if (engine?.state === GAME_STATES.BIDDING_OPEN) {
    closeClock.schedule(() => {
      if (engine?.goingOnce(lotId, sessionId)) {
        engine.setFinalCallRemaining(stages.toGoingTwiceMs);
        scheduleTwice(lotId, sessionId, generation, stages.toGoingTwiceMs);
      }
    }, closeClock.delay("openWindow"), generation);
  }
}

function scheduleTwice(lotId, sessionId, generation, delay) {
  const stages = finalCallStageDurations(settings.finalCallDurationSeconds);
  closeClock.schedule(() => {
    if (engine?.goingTwice(lotId, sessionId)) {
      engine.setFinalCallRemaining(stages.toFinalCallMs);
      scheduleFinalCall(lotId, sessionId, generation, stages.toFinalCallMs);
    }
  }, delay, generation);
}

function scheduleFinalCall(lotId, sessionId, generation, delay) {
  closeClock.schedule(() => {
    if (!engine?.finalCall(lotId, sessionId)) return;
    const remaining = finalCallStageDurations(settings.finalCallDurationSeconds).finalCallMs;
    engine.setFinalCallRemaining(remaining);
    scheduleFinal(lotId, sessionId, generation, remaining);
  }, delay, generation);
}

function scheduleFinal(lotId, sessionId, generation, delay) {
  closeClock.schedule(() => {
    if (engine?.state === GAME_STATES.FINAL_CALL) engine.closeLot(lotId, sessionId);
  }, delay, generation);
}

function scheduleRTMResolution() {
  const pending = engine?.pendingRTM;
  if (!pending) return;
  const generation = closeClock.reset();
  const sessionId = engine.activeSessionId;
  closeClock.schedule(() => {
    if (engine?.state === GAME_STATES.RTM_PENDING && !engine.isPaused) {
      engine.resolveRTM(pending.teamCode, false, pending.lotId, sessionId);
    }
  }, closeClock.delay("rtmWindow"), generation);
}

function clearAIActions() {
  aiClock.reset();
  aiTimer = null;
}

function beginAIAuctions() {
  clearAIActions();
  if (!engine?.isLotActive()) return;
  aiTeams = FRANCHISES.filter((team) => team.code !== engine.userTeam).map((team) => team.code);
  aiCursor = 0;
  scheduleNextAIResponse();
}

function scheduleNextAIResponse() {
  if (!engine?.isLotActive() || !aiTeams.length) return;
  const playerId = engine.currentPlayer?.id;
  const lotId = engine.getCurrentLotId();
  const sessionId = engine.activeSessionId;
  const teamCode = aiTeams[aiCursor % aiTeams.length];
  aiTimer = aiClock.schedule(() => {
    if (!engine?.isLotActive() || engine.currentPlayer?.id !== playerId ||
      engine.getCurrentLotId() !== lotId || !engine.isCurrentSession(sessionId)) return;
    if (auctioneer.speaking || auctioneer.queue.length) {
      scheduleNextAIResponse();
      return;
    }
    aiCursor += 1;
    engine.aiDecision(teamCode, lotId, sessionId);
    scheduleNextAIResponse();
  }, aiClock.delay("aiDelay"));
}

function userBid() {
  if (!engine.bid(engine.userTeam)) {
    announce("That bid is not available. Check your purse, squad capacity, and overseas-player limit.");
  }
  renderGame();
}

function userPass() {
  if (engine.pass()) renderGame();
}

function userSkip() {
  const now = Date.now();
  if (now < skipLockUntil) return;
  skipLockUntil = now + 500;
  if (!engine.skip(engine.userTeam, engine.getCurrentLotId())) {
    skipLockUntil = 0;
    return;
  }
  renderGame();
}

function renderGame() {
  const existingCanvas = hall?.canvas ?? null;
  const current = engine.currentPlayer;
  const userTeam = FRANCHISES.find((team) => team.code === engine.userTeam);
  const userData = engine.teams[engine.userTeam];
  const progress = engine.progressFor();
  const canAct = engine.isLotActive();
  const userOut = engine.withdrawn.has(engine.userTeam) || engine.skipped.has(engine.userTeam);
  const escapedName = escapeHtml(current?.name ?? "Auction complete");
  app.innerHTML = `
    <main class="game-shell">
      <header class="topbar">
        <a class="game-brand" href="#"><span class="brand-mark">3D</span><span>IPL AUCTION <b>3D</b></span></a>
        <div class="top-meta"><span class="live-pill"><i></i>${engine.state === GAME_STATES.RTM_PENDING ? "RTM WINDOW" : engine.state === GAME_STATES.COMPLETE ? "COMPLETE" : engine.isPaused ? "PAUSED" : "LIVE AUCTION"}</span><span>IPL ${engine.auctionSeason}</span><span>${escapeHtml(engine.mode)}</span><span>${escapeHtml(engine.difficulty)} AI</span></div>
        <div class="top-actions">
          <button class="icon-button" id="pause-btn" ${!engine.isPaused && [GAME_STATES.READY, GAME_STATES.SOLD, GAME_STATES.UNSOLD, GAME_STATES.SKIPPED, GAME_STATES.COMPLETE].includes(engine.state) ? "disabled" : ""}>${engine.isPaused ? "RESUME" : "PAUSE"}</button>
          <button class="icon-button" id="voice-toggle" aria-label="Toggle auctioneer voice">${settings.voice ? "VOICE ON" : "VOICE OFF"}</button>
          <button class="icon-button" id="save-btn">SAVE</button>
          <button class="icon-button" id="new-btn">NEW GAME</button>
        </div>
      </header>
      <section class="game-layout">
        <div class="main-column">
          <section class="scene-panel">
            <div class="scene-canvas-wrap"><canvas id="auction-scene" aria-label="Interactive three-dimensional auction auditorium"></canvas>
              <div class="scene-overlay">
                <div class="scene-kicker">THE AUCTION FLOOR <span>·</span> CUSTOM SIMULATION ORDER</div>
                <div class="scene-category">${current ? `SET ${current.auctionSetNumber} · ${escapeHtml(current.auctionSetName)} · ${escapeHtml(current.category)}` : "Auction complete"}</div>
                <div class="scene-name">${escapedName}</div>
                  ${current ? `<div class="scene-subtitle">${escapeHtml(verifiedNationalityGroup(current))} <span>·</span> ${escapeHtml(verifiedCappedStatus(current))} · ${escapeHtml(current.role)} <span>·</span> game rating ${current.rating}</div>${current.statsVerified ? `<div class="scene-subtitle verified-stats">${escapeHtml(formatVerifiedStats(current))}</div>` : `<div class="scene-subtitle stats-unknown">No verified historical statistics in this catalogue.</div>`}` : ""}
              </div>
                  ${renderAuctionQuickFacts(current, userData)}
              <div class="camera-pills">${[["wide", "WIDE"], ["stage", "STAGE"], ["auctioneer", "AUCTIONEER"], ["player", "PLAYER"], ["table", "MY TABLE"], ["leader", "LEADER"]].map(([id, label]) => `<button data-camera="${id}">${label}</button>`).join("")}</div>
            </div>
            <div class="player-strip">
              <div class="player-summary"><div class="player-initials">${current ? escapeHtml(current.name.split(" ").map((part) => part[0]).slice(0, 2).join("")) : "✓"}</div><div><small>${current ? `SET ${current.auctionSetNumber} · LOT ${String(current.lotNumber).padStart(3, "0")} · ${engine.state === GAME_STATES.INTRODUCING ? "PLAYER INTRODUCTION" : engine.state === GAME_STATES.RTM_PENDING ? "RTM RESPONSE" : engine.state === GAME_STATES.SOLD ? "SOLD" : engine.state === GAME_STATES.UNSOLD ? "UNSOLD" : engine.state === GAME_STATES.SKIPPED ? "SKIPPED" : "CURRENT PLAYER"}` : "AUCTION RESULT"}</small><h2>${escapedName}</h2><span>${current ? `${escapeHtml(current.role)} · ${escapeHtml(verifiedNationalityGroup(current))} · ${escapeHtml(current.category)} · base ${formatMoney(current.basePrice)}` : "All players have been processed"}</span></div></div>
                <div class="bid-state"><small>${engine.leadingTeam ? "CURRENT BID" : "OPENING PRICE"}</small><strong>${formatMoney(engine.currentBid || current?.basePrice || 0)}</strong><span>${engine.leadingTeam ? `${FRANCHISES.find((team) => team.code === engine.leadingTeam)?.name} leads` : current ? "No bids yet" : "Final standings available"}</span></div>
              <div class="auctioneer-avatar ${speaking ? "speaking" : ""}"><span>AUCTIONEER</span><i></i><i></i></div>
            </div>
            <div class="auction-controls">
              <div class="control-hint">${skipNotice ? escapeHtml(skipNotice) : engine.state === GAME_STATES.RTM_PENDING ? engine.pendingRTM?.teamCode === engine.userTeam ? `Verified RTM opportunity: match ${formatMoney(engine.pendingRTM.amount)} before the response window closes.` : `${FRANCHISES.find((team) => team.code === engine.pendingRTM?.teamCode)?.name ?? "Former franchise"} has a verified RTM response window.` : canAct ? userOut ? "Your franchise passed; you can still skip this player. Rival bids remain open." : `${engine.state === GAME_STATES.GOING_ONCE ? "GOING ONCE · " : engine.state === GAME_STATES.GOING_TWICE ? "GOING TWICE · " : engine.state === GAME_STATES.FINAL_CALL ? "FINAL CALL · " : ""}Bid increment: ${formatMoney(engine.getNextBid(engine.userTeam) ?? 0)} · your purse ${formatMoney(userData.purse)}` : engine.state === GAME_STATES.COMPLETE ? "Auction completed" : engine.state === GAME_STATES.INTRODUCING ? "Player introduction — bidding opens when the announcement finishes." : "Lot result recorded — the next player will be introduced automatically."}</div>
              <div class="control-buttons">
                ${canAct ? `<button class="button button-quiet" id="skip-btn">SKIP PLAYER</button><button class="button button-secondary" id="pass-btn" ${userOut ? "disabled" : ""}>PASS</button><button class="button button-primary" id="bid-btn" ${engine.canBid(engine.userTeam) ? "" : "disabled"}>BID ${formatMoney(engine.getNextBid(engine.userTeam) ?? current?.basePrice ?? 0)}</button>` : engine.state === GAME_STATES.RTM_PENDING && engine.pendingRTM?.teamCode === engine.userTeam ? `<button class="button button-secondary" id="decline-rtm">DECLINE RTM</button><button class="button button-primary" id="use-rtm">MATCH ${formatMoney(engine.pendingRTM.amount)}</button>` : ""}
              </div>
            </div>
          </section>
          ${renderAuctionProfile(current, userData)}
          <section class="content-panel">
            <nav class="tabbar">${[["auction", "Auction floor"], ["squad", "My squad"], ["catalogue", "Player catalogue"], ["history", "Auction history"], ["results", "Franchise table"]].map(([id, label]) => `<button class="tab ${activeTab === id ? "active" : ""}" data-tab="${id}">${label}</button>`).join("")}</nav>
            <div class="tab-content">${renderTab(activeTab)}</div>
          </section>
        </div>
        <aside class="side-column">
          <section class="team-card" style="--team-accent:${userTeam.colors[0]}">
            <div class="team-card-head"><div><small>YOUR FRANCHISE</small><h2>${escapeHtml(userTeam.name)}</h2></div><b>${userTeam.code}</b></div>
            <div class="purse-row"><span>Available purse</span><strong>${formatMoney(userData.purse)}</strong></div>
            <div class="team-retention-summary">${userData.retention.slotsUsed} retained · ${formatMoney(userData.retention.totalCost)} retention cost</div>
            <div class="team-stats"><div><strong>${userData.squad.length}</strong><span>SQUAD</span></div><div><strong>${userData.squad.filter((player) => player.isOverseas).length}</strong><span>OVERSEAS</span></div><div><strong>${CUSTOM_RULES.maxSquad - userData.squad.length}</strong><span>SLOTS LEFT</span></div></div>
            <div class="progress-track"><span style="width:${progress.total ? (progress.lot / progress.total) * 100 : 100}%"></span></div>
            <div class="progress-label"><span>LOT ${String(progress.lot).padStart(3, "0")} / ${progress.total}</span><span>${progress.sold} SOLD · ${progress.unsold} UNSOLD · ${progress.skipped} SKIPPED</span></div>
          </section>
          <section class="rivals-card">
            <div class="section-heading"><div><small>AUCTION FLOOR</small><h3>Rival franchises</h3></div><span>9 AI</span></div>
            <div class="rival-list">${FRANCHISES.filter((team) => team.code !== engine.userTeam).map((team) => {
              const rival = engine.teams[team.code];
              const isLeader = engine.leadingTeam === team.code;
              const eligibility = engine.getTeamEligibility(team.code);
              const overseas = rival.squad.filter((player) => player.isOverseas).length;
              const roleNeeds = Object.entries(eligibility.needs).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([role, count]) => `${role} ${count}`).join(" · ");
              return `<div class="rival-row ${isLeader ? "leading" : ""}"><span class="team-dot" style="--team-accent:${team.colors[0]}"></span><b>${team.code}</b><strong>${formatMoney(rival.purse)}</strong><span class="rival-roster">${rival.squad.length} players · ${overseas} overseas · ${rival.retention.slotsUsed} retained</span><div class="rival-meta">${isLeader ? "<i>LEADING BIDDER</i>" : ""}<small class="rival-needs">${roleNeeds ? `Needs ${escapeHtml(roleNeeds)}` : "Role targets met"} · ${escapeHtml(eligibility.reason)}</small></div></div>`;
            }).join("")}</div>
          </section>
          <section class="ticker-card"><div class="section-heading"><div><small>LIVE COMMENTARY</small><h3>Auctioneer</h3></div><span class="sound-wave">•••</span></div><p>${settings.subtitles ? escapeHtml(lastMessage) : "Subtitles off"}</p><div class="commentary-actions"><button class="button button-quiet" id="replay-commentary" ${auctioneer.latestItem ? "" : "disabled"}>REPLAY LATEST</button><button class="button button-quiet" id="voice-test">TEST VOICE</button></div><label class="toggle-row"><span>Speech commentary</span><input id="voice-checkbox" type="checkbox" ${settings.voice ? "checked" : ""}></label><label class="toggle-row"><span>Mute voice</span><input id="mute-checkbox" type="checkbox" ${settings.sound ? "" : "checked"}></label><label class="toggle-row"><span>Voice volume</span><input id="voice-volume" type="range" min="0" max="1" step="0.1" value="${settings.voiceVolume}" ${settings.voice ? "" : "disabled"}></label><label class="toggle-row"><span>Voice rate</span><input id="voice-rate" type="range" min="0.65" max="1.1" step="0.05" value="${settings.voiceRate}" ${settings.voice ? "" : "disabled"}></label><label class="toggle-row"><span>Final call (seconds)</span><input id="final-call-duration" type="range" min="5" max="10" step="1" value="${settings.finalCallDurationSeconds}"></label><label class="toggle-row"><span>Result display (seconds)</span><input id="result-display-duration" type="range" min="2" max="3" step="0.5" value="${settings.resultDisplaySeconds}"></label><label class="toggle-row"><span>Subtitles</span><input id="subtitle-checkbox" type="checkbox" ${settings.subtitles ? "checked" : ""}></label></section>
          <p class="disclaimer">Unofficial simulator. Ratings are game-generated. No real-world auction eligibility is implied.</p>
          ${DEBUG_AI ? `<section class="ticker-card ai-debug"><div class="section-heading"><div><small>DEVELOPER ONLY</small><h3>AI decision explanations</h3></div></div>${FRANCHISES.filter((team) => team.code !== engine.userTeam).map((team) => {
            const decision = engine.getAIDecision(team.code);
            const plan = engine.getAIStrategyPlan(team.code);
            const targets = Object.values(plan?.roles ?? {}).flatMap((rolePlan) => rolePlan.targets);
            const targetSummary = targets.map((target) =>
              `${escapeHtml(target.tier)} ${escapeHtml(target.playerName)} (${escapeHtml(target.role)}, max ${formatMoney(target.maximumBid)})`
            ).join(" · ");
            return `<p><b>${team.code}</b> ${decision ? `${formatMoney(decision.estimatedValue)} value · ceiling ${formatMoney(decision.limit)} · ${escapeHtml(decision.reason)}` : "No decision recorded for this lot."}</p><p class="strategy-plan"><b>${team.code} plan:</b> ${targetSummary || "No affordable role targets remain."}</p>`;
          }).join("")}</section>` : ""}
        </aside>
      </section>
    </main>`;
  if (hall && existingCanvas) {
    document.querySelector("#auction-scene").replaceWith(existingCanvas);
    hall.attachTo(existingCanvas.parentElement);
  } else {
    const canvas = document.querySelector("#auction-scene");
    try {
      hall = new AuctionHall(canvas);
      hall.setLeader(engine.leadingTeam);
    } catch (error) {
      document.querySelector(".scene-canvas-wrap").classList.add("scene-fallback");
      document.querySelector(".scene-canvas-wrap").insertAdjacentHTML("beforeend", `<div class="scene-error">3D rendering is unavailable in this browser. Auction controls remain playable.<br>${escapeHtml(error.message)}</div>`);
    }
  }
  bindGameControls();
}

function renderTab(tab) {
  if (tab === "squad") {
    const team = engine.teams[engine.userTeam];
    const roles = ["batter", "wicketkeeper", "allrounder", "bowler"];
    const retainedPlayers = team.squad.filter((player) => player.retained === true);
    const plannedTotal = plannedSpend(engine.userTargetPlan);
    return `<div class="tab-heading"><div><small>SQUAD MANAGEMENT</small><h2>${FRANCHISES.find((item) => item.code === engine.userTeam).name}</h2></div><span>${team.squad.length} / ${CUSTOM_RULES.maxSquad}</span></div>
      <section class="retention-dashboard"><div class="section-heading"><div><small>RETENTION DASHBOARD · CUSTOM ${escapeHtml(engine.mode.toUpperCase())} RULES</small><h3>Retained core</h3></div><span>${team.retention.slotsUsed} / ${retentionLimit(engine.mode, engine.customRetentionLimit)} SLOTS</span></div>
        <div class="retention-summary"><span>Retention expenditure <b>${formatMoney(team.retention.totalCost)}</b></span><span>Remaining purse <b>${formatMoney(team.purse)}</b></span><span>Squad size <b>${team.squad.length} / ${CUSTOM_RULES.maxSquad}</b></span><span>Overseas <b>${team.squad.filter((player) => player.isOverseas).length} / ${CUSTOM_RULES.maxOverseas}</b></span></div>
        ${retainedPlayers.length ? `<div class="table-wrap"><table><thead><tr><th>RETAINED PLAYER</th><th>ROLE</th><th>RECORDED SIMULATION COST</th></tr></thead><tbody>${retainedPlayers.map((player) => `<tr><td>${escapeHtml(player.name)}</td><td>${escapeHtml(player.role)}</td><td>${formatMoney(player.retentionCost)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty-state">No players were retained for this franchise.</p>`}
        <p class="data-note">${team.retention.releasedPlayerIds.length} players released from the supplied seed list; ${team.retention.releasedPlayers.filter((record) => record.auctionEligibility === "base-price-configured").length} have a configured simulation base price. These seed associations are unverified and do not claim official roster status.</p>
        ${team.retention.releasedPlayers.length ? `<div class="retention-released-list">${team.retention.releasedPlayers.map((release) => `<span>${escapeHtml(release.playerName)} · ${escapeHtml(release.status)}</span>`).join("")}</div>` : ""}
      </section>
      <section class="user-plan-dashboard"><div class="section-heading"><div><small>PRE-AUCTION PLAN</small><h3>My targets</h3></div><span>${engine.userTargetPlan.length} TARGETS</span></div>
        ${engine.userTargetPlan.length ? `<div class="plan-overview">${engine.userTargetPlan.map((target) => {
          const player = PLAYERS.find((item) => item.id === target.playerId);
          return `<div><b>${escapeHtml(target.priority.toUpperCase())} · ${escapeHtml(player?.name ?? "Unknown player")}</b><small>${escapeHtml(player?.role ?? "N/A")} · role priority ${target.rolePriority} · preferred limit ${formatMoney(target.spendLimit)} · ${player ? escapeHtml(catalogueStatus(player)) : "N/A"}</small></div>`;
        }).join("")}</div>` : `<p class="empty-state">No target plan was saved before the auction.</p>`}
        <div class="analytics-row"><span>All target limits <b>${formatMoney(plannedTotal)}</b></span><span>Projected remaining at start <b>${formatProjectedBudget(team.retention.remainingPurse - plannedTotal)}</b></span></div>
      </section>
      <div class="role-chips">${roles.map((role) => `<span>${role}: ${team.squad.filter((player) => player.role === role).length}</span>`).join("")}</div>
      ${team.squad.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>PLAYER</th><th>ROLE</th><th>TYPE</th><th>PRICE</th></tr></thead><tbody>${team.squad.map((player, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(player.name)}</td><td>${escapeHtml(player.role)}</td><td>${player.isOverseas ? "Overseas" : "Indian"}</td><td>${player.retained ? `Retained · ${formatMoney(player.retentionCost)}` : formatMoney(player.purchasePrice)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">Your squad is ready to be built. Place bids on the auction floor to sign players.</div>`}
      <div class="analytics-row"><span>Spent <b>${formatMoney(CUSTOM_RULES.purse - team.purse)}</b></span><span>Remaining slots <b>${CUSTOM_RULES.maxSquad - team.squad.length}</b></span></div>`;
  }
  if (tab === "catalogue") {
    const categories = [...new Set(PLAYERS.map((player) => player.category).filter(Boolean))].sort();
    const coverage = buildPlayerDataCoverage(PLAYERS);
    const verifiedCount = PLAYERS.filter((player) => player.season2026AssociationStatus === "verified").length;
    const auctionEligibleCount = engine.queue.length;
    return `<div class="tab-heading"><div><small>PLAYER DATABASE</small><h2>Player catalogue</h2></div><span>${PLAYERS.length} unique · ${verifiedCount} verified associations · ${PLAYERS.length - verifiedCount} unverified</span></div>
      <section class="coverage-report"><div class="section-heading"><div><small>STATISTICS COVERAGE</small><h3>Verified data, not estimates</h3></div><span>${coverage.totalUniquePlayers} unique players</span></div>
        <div class="coverage-grid"><span>Full catalogue records <b>${coverage.totalCatalogueRecords}</b></span><span>Batters with verified stats <b>${coverage.verifiedByRole.batters}</b></span><span>Bowlers with verified stats <b>${coverage.verifiedByRole.bowlers}</b></span><span>All-rounders with verified stats <b>${coverage.verifiedByRole.allrounders}</b></span><span>Wicketkeepers with verified stats <b>${coverage.verifiedByRole.wicketkeepers}</b></span><span>IPL 2025 verified <b>${coverage.verifiedIPL2025}</b></span><span>IPL career verified <b>${coverage.verifiedIPLCareer}</b></span><span>Other T20 verified <b>${coverage.verifiedOtherT20}</b></span><span>Domestic verified <b>${coverage.verifiedDomestic}</b></span><span>Partial profiles <b>${coverage.partialProfiles}</b></span><span>Simulation estimates only <b>${coverage.simulationEstimatesOnly}</b></span><span>Insufficient data <b>${coverage.insufficientData}</b></span></div>
      </section>
      <div class="catalogue-totals"><span>Auction-eligible <b>${auctionEligibleCount}</b></span><span>Excluded from this auction <b>${PLAYERS.length - auctionEligibleCount}</b></span></div>
      <div class="filters catalogue-filters">
        <input class="catalogue-filter" data-filter="query" value="${escapeHtml(catalogueFilters.query)}" placeholder="Search player name..." aria-label="Search player name">
        <select class="catalogue-filter" data-filter="franchise" aria-label="Franchise"><option value="">All verified franchises</option>${FRANCHISES.map((team) => `<option value="${team.code}" ${catalogueFilters.franchise === team.code ? "selected" : ""}>${team.code}</option>`).join("")}</select>
        <select class="catalogue-filter" data-filter="nationality" aria-label="Nationality"><option value="">India / overseas</option><option value="India" ${catalogueFilters.nationality === "India" ? "selected" : ""}>Indian</option><option value="Overseas" ${catalogueFilters.nationality === "Overseas" ? "selected" : ""}>Overseas</option></select>
        <select class="catalogue-filter" data-filter="role" aria-label="Role"><option value="">All roles</option>${["batter", "allrounder", "wicketkeeper", "bowler", "unknown"].map((role) => `<option value="${role}" ${catalogueFilters.role === role ? "selected" : ""}>${role}</option>`).join("")}</select>
        <select class="catalogue-filter" data-filter="category" aria-label="Auction category"><option value="">All categories</option>${categories.map((category) => `<option value="${escapeHtml(category)}" ${catalogueFilters.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select>
        <select class="catalogue-filter" data-filter="capped" aria-label="Capped status"><option value="">Capped status</option><option value="capped" ${catalogueFilters.capped === "capped" ? "selected" : ""}>Capped</option><option value="uncapped" ${catalogueFilters.capped === "uncapped" ? "selected" : ""}>Uncapped</option></select>
        <select class="catalogue-filter" data-filter="status" aria-label="Auction status"><option value="">All auction statuses</option>${["eligible", "retained", "released", "sold", "unsold", "skipped"].map((status) => `<option value="${status}" ${catalogueFilters.status === status ? "selected" : ""}>${status}</option>`).join("")}</select>
        <label>Base price min<input class="catalogue-filter" data-filter="minimumPrice" type="number" min="0" value="${escapeHtml(catalogueFilters.minimumPrice)}"></label>
        <label>Base price max<input class="catalogue-filter" data-filter="maximumPrice" type="number" min="0" value="${escapeHtml(catalogueFilters.maximumPrice)}"></label>
        <label>Rating min<input class="catalogue-filter" data-filter="minimumRating" type="number" min="0" max="100" value="${escapeHtml(catalogueFilters.minimumRating)}"></label>
        <label>Rating max<input class="catalogue-filter" data-filter="maximumRating" type="number" min="0" max="100" value="${escapeHtml(catalogueFilters.maximumRating)}"></label>
        <select class="catalogue-filter" data-filter="sort" aria-label="Sort catalogue"><option value="name">Sort: name</option><option value="basePrice" ${catalogueFilters.sort === "basePrice" ? "selected" : ""}>Sort: base price</option><option value="rating" ${catalogueFilters.sort === "rating" ? "selected" : ""}>Sort: rating</option><option value="runs" ${catalogueFilters.sort === "runs" ? "selected" : ""}>Sort: verified runs</option><option value="wickets" ${catalogueFilters.sort === "wickets" ? "selected" : ""}>Sort: verified wickets</option><option value="strikeRate" ${catalogueFilters.sort === "strikeRate" ? "selected" : ""}>Sort: verified strike rate</option></select>
      </div>
      <div id="catalogue-list" class="catalogue-list">${renderCatalogue()}</div><p class="data-note">Country, capped status, historical auction results, and season eligibility are shown as N/A unless verified. Ratings and base prices are simulated; no statistics are inferred.</p>`;
  }
  if (tab === "results") {
    return `<div class="tab-heading"><div><small>FRANCHISE DASHBOARDS · LIVE ENGINE STATE</small><h2>${engine.state === GAME_STATES.COMPLETE ? "Final standings" : "Live franchise table"}</h2></div><span>${engine.state === GAME_STATES.COMPLETE ? "AUCTION COMPLETE" : "LIVE"}</span></div>
      <div class="franchise-dashboard-grid">${FRANCHISES.map((team) => {
        const roster = engine.teams[team.code];
        const dashboard = engine.getFranchiseDashboard(team.code);
        const roles = dashboard.roleCounts;
        const missing = dashboard.missingRoles.map(({ role, count }) => `${role} ${count}`).join(" · ") || "No game-defined role gaps";
        const released = dashboard.releasedPlayers;
        return `<article class="franchise-dashboard ${team.code === engine.userTeam ? "user-row" : ""}" style="--team-accent:${team.colors[0]}">
          <div class="team-card-head"><div><small>${escapeHtml(team.name)}</small><h3>${team.code}</h3></div><b>${formatMoney(roster.purse)}</b></div>
          <div class="franchise-dashboard-stats"><span>Squad ${dashboard.squadSize}/${CUSTOM_RULES.maxSquad}</span><span>Slots left ${dashboard.remainingSlots}</span><span>Retained ${dashboard.retentionCount}/${dashboard.retentionLimit}</span><span>Retention ${formatMoney(dashboard.retentionCost)}</span><span>Overseas ${dashboard.overseasCount}${dashboard.unknownOverseasCount ? ` · ${dashboard.unknownOverseasCount} unknown` : ""}</span></div>
          <div class="franchise-role-counts">${Object.entries(roles).map(([role, count]) => `<span>${role} ${count}</span>`).join("")}<span>pace known ${dashboard.paceCount}</span><span>spin known ${dashboard.spinCount}</span><span>bowling style N/A ${dashboard.unknownBowlingStyleCount}</span></div>
          <p><b>Needs:</b> ${escapeHtml(missing)}</p>
          <p><b>Seed list:</b> ${dashboard.seedPlayers.length} unverified records</p>
          <details><summary>Initial seed player list</summary><p>${escapeHtml(dashboard.seedPlayers.map((player) => player.name).join(", ") || "No seed records")}</p></details>
          <details><summary>Verified 2026 reference squad · ${dashboard.verifiedReferenceSquad.length}</summary><p>${escapeHtml(dashboard.verifiedReferenceSquad.map((player) => player.name).join(", ") || "No verified reference records")}</p></details>
          <p><b>Retained:</b> ${escapeHtml(dashboard.retainedPlayers.map((player) => player.name).join(", ") || "None")}</p>
          <p><b>Released:</b> ${escapeHtml(released.map((record) => record.playerName).join(", ") || "None")}</p>
          <p><b>Purchased:</b> ${escapeHtml(dashboard.purchasedPlayers.map((player) => player.name).join(", ") || "None")}</p>
          <p><b>Strategy:</b> ${escapeHtml(dashboard.personality)} · focus ${escapeHtml(dashboard.strategy.focusRoles.join(", "))}</p>
        </article>`;
      }).join("")}</div>
      ${engine.state === GAME_STATES.COMPLETE ? `<div class="empty-state">All team totals are calculated from finalized auction purchases. Tournament simulation is not included in this build.</div>` : ""}`;
  }
  if (tab === "history") {
    const history = [...engine.history].reverse().slice(0, 100);
    const playersById = new Map(PLAYERS.map((player) => [player.id, player]));
    return `<div class="tab-heading"><div><small>EVENT LOG</small><h2>Auction history</h2></div><span>${engine.history.length} EVENTS</span></div>
      ${history.length ? `<div class="table-wrap"><table><thead><tr><th>LOT</th><th>PLAYER</th><th>EVENT</th><th>FRANCHISE</th><th>AMOUNT</th></tr></thead><tbody>${history.map((item) => `<tr><td>${item.lotNumber ? String(item.lotNumber).padStart(3, "0") : "—"}</td><td>${escapeHtml(playersById.get(item.playerId)?.name ?? "Unknown player")}</td><td>${escapeHtml(item.result.toUpperCase())}</td><td>${escapeHtml(item.teamCode ?? "—")}</td><td>${item.amount ? formatMoney(item.amount) : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">Accepted bids, passes, skips, and finalized results will appear here.</div>`}`;
  }
  const upcoming = engine.queue.slice(engine.index + 1, engine.index + 7);
  return `<div class="floor-details"><div class="auction-progress-card"><small>AUCTION PROGRESS</small><div class="big-progress">${progressPercent()}<span>%</span></div><div class="progress-track"><span style="width:${progressPercent()}%"></span></div><p>${engine.completedCount} lots finalized of ${engine.queue.length}</p></div>
    <div class="upcoming-card"><div class="section-heading"><div><small>UP NEXT</small><h3>Upcoming lots</h3></div></div>${upcoming.length ? upcoming.map((player) => `<div class="upcoming-row"><span>${String(player.lotNumber).padStart(3, "0")}</span><b>${escapeHtml(player.name)}</b><span>${escapeHtml(player.category)}</span><strong>${formatMoney(player.basePrice)}</strong></div>`).join("") : `<p class="empty-state">No more players in the queue.</p>`}</div>
    <p class="data-note">Pass withdraws only your franchise from this lot. Skip Player finalizes the player as skipped without a sale or charge and automatically advances the auction.</p></div>`;
}

function progressPercent() {
  if (!engine.queue.length) return 100;
  const finalizedCurrent = [GAME_STATES.SOLD, GAME_STATES.UNSOLD, GAME_STATES.SKIPPED].includes(engine.state) ? 1 : 0;
  return Math.round(((engine.index + finalizedCurrent) / engine.queue.length) * 1000) / 10;
}

function renderCatalogue(players) {
  const filtered = (players ?? filterCatalogue(PLAYERS, catalogueFilters, catalogueStatus)).slice(0, 150);
  const selected = PLAYERS.find((player) => player.id === selectedCataloguePlayerId);
  const detail = selected ? renderCatalogueDetail(selected) : "";
  const list = filtered.map((player) => `<button class="catalogue-item ${player.id === selectedCataloguePlayerId ? "selected" : ""}" data-player-id="${escapeHtml(player.id)}" aria-pressed="${player.id === selectedCataloguePlayerId}">
    <span class="player-initials small">${escapeHtml(player.name.split(" ").map((part) => part[0]).slice(0, 2).join(""))}</span>
    <span><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.role)} · ${escapeHtml(player.category ?? "Category unavailable")} · ${escapeHtml(verifiedNationalityGroup(player))} · ${escapeHtml(catalogueStatus(player))}</small></span><strong>${formatMoney(player.basePrice)}</strong>
  </button>`).join("") || `<div class="empty-state">No players match these filters.</div>`;
  return `${detail}${list}`;
}

function catalogueStatus(player) {
  if (engine.retainedIds.has(player.id)) return "retained";
  if (FRANCHISES.some((team) => (engine.teams[team.code].retention.releasedPlayerIds ?? []).includes(player.id))) return "released";
  if (player.season2026AssociationStatus === "verified" && player.season2026SquadStatus === "released") return "released";
  if (engine.soldPlayerIds.has(player.id)) return "sold";
  const result = [...engine.history].reverse().find((item) =>
    item.playerId === player.id && ["unsold", "skipped"].includes(item.result)
  );
  if (result?.result === "unsold") return "unsold";
  if (result?.result === "skipped" && result.skipReason === "USER_SKIPPED") return "skipped";
  return engine.eligiblePlayerIds.has(player.id) ? "eligible" : "unavailable";
}

function renderCatalogueDetail(player) {
  const stats = statisticsForAuctionSeason(player, engine.auctionSeason);
  const statsSummary = stats ? `${profileStatsForRole(player, stats)}<p class="profile-source">${escapeHtml(stats.period)} · ${(stats.sources ?? []).map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.name)}</a>`).join(" · ") || "No verified source for this period"}</p>` : `<p>IPL ${engine.auctionSeason - 1} season statistics: N/A; not researched.</p>`;
  const simulationResult = [...engine.history].reverse().find((item) =>
    item.playerId === player.id && ["sold", "unsold", "skipped"].includes(item.result)
  );
  const franchise = verifiedFranchiseForCatalogue(player);
  const capped = verifiedCappedStatus(player);
  return `<section class="catalogue-detail"><div class="section-heading"><div><small>PLAYER DETAILS</small><h3>${escapeHtml(player.name)}</h3></div><button class="button button-quiet" data-close-player>Close</button></div>
    <p>Nationality group: ${escapeHtml(verifiedNationalityGroup(player))} · Country: N/A · ${escapeHtml(player.role)} (${escapeHtml(player.roleStatus ?? "role source unavailable")}) · Secondary role: ${escapeHtml(player.secondaryRole ?? "N/A")}</p>
    <p>Batting style: ${escapeHtml(player.battingHand ?? "N/A")} · Bowling style: ${escapeHtml(player.bowlingStyle ?? "N/A")} · ${player.isOverseas === true ? "Overseas" : player.isOverseas === false ? "Domestic" : "Nationality unavailable"} · ${capped}</p>
    <p>Verified 2026 franchise association: ${escapeHtml(franchise)} · ${escapeHtml(simulationOwnership(player))} · Participation eligibility: ${escapeHtml(player.auctionEligibility ?? "N/A")}</p>
    <p>Seed-list associations: ${escapeHtml((player.seedFranchiseCodes ?? []).join(", ") || "None")} (unverified) · Aliases: ${escapeHtml((player.aliases ?? []).join(", ") || "None")}</p>
    <p>Base price: ${formatMoney(player.basePrice)} (simulated) · Rating: ${player.rating} (simulated) · Status: ${escapeHtml(catalogueStatus(player))}</p>
    <div class="catalogue-period-stats"><b>IPL ${engine.auctionSeason - 1} pre-auction season statistics</b>${statsSummary}<p>IPL career through 2025-06-03: batting runs ${displayStat(player.statistics?.iplCareer?.batting?.runs)} · wickets ${displayStat(player.statistics?.iplCareer?.bowling?.wickets)}</p><p>Other T20 career: batting runs ${displayStat(player.statistics?.otherT20Career?.batting?.runs)} · wickets ${displayStat(player.statistics?.otherT20Career?.bowling?.wickets)}</p><p>Domestic records: ${displayStat(player.statistics?.domestic?.competition)} · batting runs ${displayStat(player.statistics?.domestic?.batting?.runs)} · wickets ${displayStat(player.statistics?.domestic?.bowling?.wickets)}</p></div>
    <div class="catalogue-ratings">${relevantRatingKeys(player.role).map((key) => { const rating = player.simulationRatings?.[key]; return `<span>${escapeHtml(key)}: ${rating?.value ?? "N/A"} (${rating?.status === "verified-data-derived" ? "data-derived" : "estimated"}; ${escapeHtml(rating?.confidence ?? "N/A")} confidence)</span>`; }).join(" · ")}</div>
    <p>Data confidence: ${escapeHtml(player.dataConfidence ?? "N/A")} · Missing fields: ${(player.missingFields ?? []).length}</p>
    <p>Historical auction result: N/A · This simulation: ${simulationResult ? escapeHtml(simulationResult.result.toUpperCase()) : "No result yet"}${simulationResult?.amount ? ` · ${formatMoney(simulationResult.amount)}` : ""}</p>
    <p>AI evaluation: ${DEBUG_AI && engine.currentPlayer?.id === player.id ? "See developer AI decision explanations." : "N/A"}</p>
  </section>`;
}

function bindGameControls() {
  document.querySelector("#pause-btn")?.addEventListener("click", () => {
    if (engine.isPaused) engine.resume();
    else engine.pause();
  });
  document.querySelector("#bid-btn")?.addEventListener("click", userBid);
  document.querySelector("#pass-btn")?.addEventListener("click", userPass);
  document.querySelector("#skip-btn")?.addEventListener("click", userSkip);
  document.querySelector("#use-rtm")?.addEventListener("click", () => engine.resolveRTM(engine.userTeam, true));
  document.querySelector("#decline-rtm")?.addEventListener("click", () => engine.resolveRTM(engine.userTeam, false));
  document.querySelector("#save-btn")?.addEventListener("click", saveAuction);
  document.querySelector("#new-btn")?.addEventListener("click", () => {
    if (confirm("Start a new auction? Your current progress will be replaced.")) renderSetup();
  });
  document.querySelector("#voice-toggle")?.addEventListener("click", () => {
    settings.voice = !settings.voice;
    persistSettings();
    if (!settings.voice) auctioneer.cancelActive();
    renderGame();
  });
  document.querySelector("#voice-checkbox")?.addEventListener("change", (event) => {
    settings.voice = event.target.checked;
    persistSettings();
    if (!settings.voice && "speechSynthesis" in window) {
      auctioneer.cancelActive();
    }
    renderGame();
  });
  document.querySelector("#replay-commentary")?.addEventListener("click", () => auctioneer.replayLatest());
  document.querySelector("#voice-test")?.addEventListener("click", () => {
    if (!("speechSynthesis" in window)) {
      announce("Speech synthesis is unavailable in this browser.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance("Auctioneer voice test. The next valid bid will be announced.");
    utterance.rate = settings.voiceRate;
    utterance.volume = settings.sound ? settings.voiceVolume : 0;
    window.speechSynthesis.speak(utterance);
  });
  document.querySelector("#mute-checkbox")?.addEventListener("change", (event) => {
    settings.sound = !event.target.checked;
    persistSettings();
  });
  document.querySelector("#subtitle-checkbox")?.addEventListener("change", (event) => {
    settings.subtitles = event.target.checked;
    persistSettings();
    renderGame();
  });
  document.querySelector("#voice-volume")?.addEventListener("input", (event) => {
    settings.voiceVolume = Number(event.target.value);
    persistSettings();
  });
  document.querySelector("#voice-rate")?.addEventListener("input", (event) => {
    settings.voiceRate = Number(event.target.value);
    persistSettings();
  });
  document.querySelector("#final-call-duration")?.addEventListener("input", (event) => {
    settings.finalCallDurationSeconds = normalizeFinalCallDuration(event.target.value);
    persistSettings();
  });
  document.querySelector("#result-display-duration")?.addEventListener("input", (event) => {
    settings.resultDisplaySeconds = Math.max(2, Math.min(3, Number(event.target.value)));
    persistSettings();
  });
  document.querySelectorAll("[data-camera]").forEach((button) => button.addEventListener("click", () => hall?.animateTo(button.dataset.camera)));
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
    activeTab = button.dataset.tab;
    renderGame();
  }));
  const catalogueList = document.querySelector("#catalogue-list");
  if (catalogueList) {
    const updateCatalogue = () => {
      const filtered = filterCatalogue(PLAYERS, catalogueFilters, catalogueStatus);
      catalogueList.innerHTML = renderCatalogue(filtered.slice(0, 150));
    };
    document.querySelectorAll(".catalogue-filter").forEach((control) => {
      const eventName = control.tagName === "SELECT" ? "change" : "input";
      control.addEventListener(eventName, () => {
        catalogueFilters[control.dataset.filter] = control.value;
        updateCatalogue();
      });
    });
    catalogueList.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-player]")) {
        selectedCataloguePlayerId = null;
        updateCatalogue();
        return;
      }
      const playerButton = event.target.closest("[data-player-id]");
      if (!playerButton) return;
      selectedCataloguePlayerId = playerButton.dataset.playerId;
      updateCatalogue();
    });
  }
}

window.addEventListener("beforeunload", () => {
  clearTimers();
  hall?.dispose();
});

renderSetup();
