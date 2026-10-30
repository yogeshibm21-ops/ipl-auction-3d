import { PLAYERS, validatePlayers } from "../src/data/players.js";
import { buildPlayerDataCoverage, validateVerifiedStatRecords } from "../src/data/PlayerProfiles.js";
import { VERIFIED_STAT_RECORDS } from "../src/data/verifiedStats.js";

const errors = [
  ...validatePlayers(),
  ...validateVerifiedStatRecords(VERIFIED_STAT_RECORDS, PLAYERS)
];

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(buildPlayerDataCoverage(PLAYERS), null, 2));
}
