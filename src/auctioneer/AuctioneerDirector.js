const SMALL_NUMBERS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
  "eighteen", "nineteen"
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function underThousand(value) {
  if (value < 20) return SMALL_NUMBERS[value];
  if (value < 100) return `${TENS[Math.floor(value / 10)]}${value % 10 ? `-${SMALL_NUMBERS[value % 10]}` : ""}`;
  return `${SMALL_NUMBERS[Math.floor(value / 100)]} hundred${value % 100 ? ` ${underThousand(value % 100)}` : ""}`;
}

function integerWords(value) {
  if (!Number.isSafeInteger(value) || value < 0) return String(value);
  if (value === 0) return "zero";
  const chunks = [];
  const units = ["", "thousand", "million", "billion"];
  let remaining = value;
  let unitIndex = 0;
  while (remaining) {
    const chunk = remaining % 1000;
    if (chunk) chunks.unshift(`${underThousand(chunk)}${units[unitIndex] ? ` ${units[unitIndex]}` : ""}`);
    remaining = Math.floor(remaining / 1000);
    unitIndex += 1;
  }
  return chunks.join(" ");
}

export function moneyInWords(lakh) {
  if (!Number.isInteger(lakh) || lakh < 0) return "an unknown amount";
  const crore = Math.floor(lakh / 100);
  const remainder = lakh % 100;
  const amount = crore
    ? `${integerWords(crore)} crore${remainder ? ` ${integerWords(remainder)} lakh` : ""}`
    : `${integerWords(lakh)} lakh`;
  return `${amount} rupees`;
}

function playerIntroduction(player, basePrice) {
  const nationalityVerified = String(player?.nationalityStatus ?? "").toLocaleLowerCase().split(/[^a-z]+/).includes("verified");
  const nationality = !nationalityVerified ? "" : player?.nationalityGroup === "India" ? "Indian" :
    player?.nationalityGroup === "Overseas" ? "overseas" : "";
  const role = player?.role ?? "cricketer";
  const capped = player?.cappedStatus === "verified" && typeof player.capped === "boolean"
    ? player.capped ? "capped" : "uncapped"
    : "";
  const descriptors = [capped, nationality, role].filter(Boolean);
  const description = descriptors.join(" ");
  const article = /^[aeiou]/i.test(description) ? "An" : "A";
  const profile = description ? `${article} ${description}.` : "A player.";
  const highlight = player?.careerHighlightStatus === "verified" && player.careerHighlight
    ? ` ${player.careerHighlight.trim()}`
    : "";
  return `Next up for auction is ${player?.name ?? "our next player"}. ${profile}${highlight} Their base price is ${moneyInWords(basePrice)}. Who will open the bidding?`;
}

export function commentaryFor(event, franchiseNames) {
  const playerName = event.player?.name ?? "The player";
  const team = franchiseNames[event.teamCode] ?? event.teamCode ?? "";
  const amount = Number.isInteger(event.amount) ? moneyInWords(event.amount) : "";
  switch (event.type) {
    case "auction-opening":
      return `Welcome to the IPL ${event.mode ?? "auction"}! All ten franchises are ready to build their squads. The retention phase is complete, and our auction is about to begin. Let us welcome our first player to the auction stage!`;
    case "category-start":
      return `Welcome to the ${event.category} category. Set ${event.setNumber}, ${event.setName ?? event.category}, in the custom simulation order.`;
    case "category-transition":
      return `That concludes the ${event.previousCategory} category. We now move to the ${event.nextCategory} category.`;
    case "player-presented":
      return `Lot ${String(event.lotNumber ?? 0).padStart(3, "0")}. Set ${event.player?.auctionSetNumber ?? "N/A"}, ${event.player?.auctionSetName ?? event.auctionCategory ?? "custom"}. ${playerIntroduction(event.player, event.basePrice)}`;
    case "bid": {
      const previousAmount = event.previousBid ?? 0;
      if (previousAmount === 0) return `${team} open the bidding at ${amount}!`;
      if (event.previousTeamCode === event.teamCode) return `${team} raise the bid to ${amount}!`;
      if (event.bidderHasBid) return `${team} return with a bid of ${amount}!`;
      return `${team} enter the bidding at ${amount}!`;
    }
    case "going-once":
      return event.teamCode ? `Going once at ${amount}!` : "Going once with no bids!";
    case "going-twice":
      return event.teamCode ? `Going twice at ${amount}! Any final bids?` : "Going twice with no bids!";
    case "final-call":
      return `Final call! Any other franchise? Last chance to bid on ${playerName}!`;
    case "rtm-offered":
      return `The highest bid is ${amount}. ${team} may use its verified right to match this bid.`;
    case "sold":
      return `Sold! ${playerName} goes to ${team} for ${amount}${event.rtm ? " using the right to match" : ""}!`;
    case "unsold":
      return `No bids received. ${playerName} remains unsold at the base price.`;
    case "skipped":
      return `${playerName} is skipped and will not be sold in this auction.`;
    case "pass":
      return `${team} pass on ${playerName}.`;
    default:
      return "";
  }
}

const TERMINAL_EVENTS = new Set(["sold", "unsold", "skipped"]);
const CATEGORY_EVENTS = new Set(["category-start", "category-transition"]);
const COALESCED_EVENTS = new Set(["bid", "going-once", "going-twice", "final-call"]);

export class AuctioneerDirector {
  constructor({ speak = () => {}, onSubtitle = () => {}, cancelSpeech = () => {}, onComplete = () => {} } = {}) {
    this.speak = speak;
    this.onSubtitle = onSubtitle;
    this.cancelSpeech = cancelSpeech;
    this.onComplete = onComplete;
    this.queue = [];
    this.seen = new Set();
    this.speaking = false;
    this.sequence = 0;
    this.epoch = 0;
    this.activeComplete = null;
    this.activeItem = null;
    this.currentLotId = null;
    this.currentSessionId = null;
    this.latestItem = null;
  }

  handle(event, franchiseNames) {
    const key = event.id ?? `${event.type}:${event.lotId ?? "none"}:${event.teamCode ?? "none"}:${event.amount ?? 0}:${event.timestamp}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > 600) this.seen.delete(this.seen.values().next().value);
    if (event.type === "player-presented" || CATEGORY_EVENTS.has(event.type)) {
      this.currentLotId = event.lotId;
      this.currentSessionId = event.sessionId ?? null;
    }
    if (event.sessionId != null && this.currentSessionId != null && event.sessionId !== this.currentSessionId) return false;
    if (event.lotId && this.currentLotId && event.lotId !== this.currentLotId) return false;
    const line = commentaryFor(event, franchiseNames);
    if (!line) return false;

    const item = {
      id: ++this.sequence,
      lotId: event.lotId ?? this.currentLotId,
      sessionId: event.sessionId ?? this.currentSessionId,
      line,
      type: event.type,
      onComplete: event.type === "auction-opening" || event.type === "player-presented" ||
        TERMINAL_EVENTS.has(event.type) || CATEGORY_EVENTS.has(event.type) ||
        event.type === "going-twice" || event.type === "final-call"
        ? () => this.onComplete(event)
        : null
    };
    this.latestItem = item;

    if (event.type === "player-presented") {
      this.queue = [];
      this.cancelActive();
    } else if (event.type === "bid") {
      this.queue = this.queue.filter((queued) => !COALESCED_EVENTS.has(queued.type));
      if (this.activeItem?.lotId === item.lotId && COALESCED_EVENTS.has(this.activeItem.type)) this.cancelActive();
    } else if (TERMINAL_EVENTS.has(event.type)) {
      this.queue = [];
      this.cancelActive();
    }
    this.onSubtitle(line, item);
    this.queue.push(item);
    this.drain();
    return true;
  }

  drain() {
    if (this.speaking || !this.queue.length) return;
    const item = this.queue.shift();
    this.speaking = true;
    this.activeItem = item;
    const epoch = this.epoch;
    let finished = false;
    const complete = () => {
      if (finished) return;
      finished = true;
      if (epoch !== this.epoch) return;
      this.activeComplete = null;
      this.activeItem = null;
      this.speaking = false;
      if (item.sessionId == null || item.sessionId === this.currentSessionId) item.onComplete?.();
      this.drain();
    };
    this.activeComplete = complete;
    try {
      const result = this.speak(item.line, complete, item);
      if (result && typeof result.then === "function") result.then(complete, complete);
      else if (this.speak.length < 2) complete();
    } catch {
      complete();
    }
  }

  cancelActive() {
    const activeComplete = this.activeComplete;
    if (!activeComplete) return;
    try { this.cancelSpeech(); } catch { /* speech cancellation is best-effort */ }
    activeComplete();
  }

  replayLatest() {
    if (!this.latestItem) return false;
    const item = { ...this.latestItem, id: ++this.sequence, onComplete: null };
    this.queue = this.queue.filter((queued) => queued.lotId === item.lotId);
    this.queue.push(item);
    this.drain();
    return true;
  }

  clear() {
    this.epoch += 1;
    try { this.cancelSpeech(); } catch { /* speech cancellation is best-effort */ }
    this.activeComplete = null;
    this.activeItem = null;
    this.queue = [];
    this.seen.clear();
    this.speaking = false;
    this.currentLotId = null;
    this.currentSessionId = null;
    this.latestItem = null;
  }
}
