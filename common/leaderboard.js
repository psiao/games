// ---------------------------------------------------------------------------
// leaderboard.js — shared cross-game leaderboard writer.
// Scores bucket by period (all / year / month / ISO-week) under lb/{scope}/{eid}
// with a per-game breakdown in byGame.{game}. Change scoring shape here once.
// ---------------------------------------------------------------------------
import { db } from "./firebase-config.js";
import { ref, runTransaction } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

export function weekKey(ts) {
  const dt = new Date(ts);
  const u = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  const day = u.getUTCDay() || 7;
  u.setUTCDate(u.getUTCDate() + 4 - day);
  const yStart = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((u - yStart) / 86400000) + 1) / 7);
  return u.getUTCFullYear() + "-W" + String(wk).padStart(2, "0");
}
export function periodKeys(ts) {
  const d = new Date(ts);
  const year = String(d.getFullYear());
  const month = year + "-" + String(d.getMonth() + 1).padStart(2, "0");
  return ["all", year, month, weekKey(ts)];
}
export async function addToLeaderboard(eid, name, game, points, won) {
  if (!eid) return;
  const now = Date.now();
  for (const scope of periodKeys(now)) {
    try {
      await runTransaction(ref(db, `lb/${scope}/${eid}`), (cur) => {
        cur = cur || { name, points: 0, wins: 0, games: 0, byGame: {} };
        cur.points = (cur.points || 0) + points;
        cur.wins = (cur.wins || 0) + (won ? 1 : 0);
        cur.games = (cur.games || 0) + 1;
        cur.byGame = cur.byGame || {};
        cur.byGame[game] = (cur.byGame[game] || 0) + points;
        cur.name = name || cur.name;
        cur.ts = now;
        return cur;
      });
    } catch {}
  }
}
