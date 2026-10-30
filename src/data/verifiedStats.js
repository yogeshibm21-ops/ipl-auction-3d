const IPL_2025_SOURCE = Object.freeze({
  name: "IPL.com IPL 2025 statistics leaderboard",
  url: "https://www.ipl.com/series/indian-premier-league-2025-129413/stats",
  cutoff: "2025-06-03",
  verifiedAt: "2026-10-30"
});

export const VERIFIED_STAT_RECORDS = Object.freeze([
  { playerName: "Sai Sudharsan", period: "ipl2025", section: "batting", field: "runs", value: 759, source: IPL_2025_SOURCE },
  { playerName: "Suryakumar Yadav", period: "ipl2025", section: "batting", field: "runs", value: 717, source: IPL_2025_SOURCE },
  { playerName: "Virat Kohli", period: "ipl2025", section: "batting", field: "runs", value: 657, source: IPL_2025_SOURCE },
  { playerName: "Prasidh Krishna", period: "ipl2025", section: "bowling", field: "wickets", value: 25, source: IPL_2025_SOURCE },
  { playerName: "Noor Ahmad", period: "ipl2025", section: "bowling", field: "wickets", value: 24, source: IPL_2025_SOURCE },
  { playerName: "Josh Hazlewood", period: "ipl2025", section: "bowling", field: "wickets", value: 22, source: IPL_2025_SOURCE }
]);
