// Unit test for codex-bg-stuck.mjs (no side effects, no app needed).
import { classifyStuck, STUCK_DIALOG_MIN_SEC, STUCK_VISIBLE_MIN_SEC, STUCK_HARD_MIN_SEC, STUCK_REPAIR_COOLDOWN_MS, STUCK_LIST_FAIL_SEC } from './codex-bg-stuck.mjs';

let fail = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};
const act = (s) => classifyStuck(s).action;
const why = (s) => classifyStuck(s).reason;

// healthy / port down
eq('healthy(3 targets)', act({ pageTargets: 3, zeroTargetsSec: 0 }), 'none');
eq('port down', act({ pageTargets: null, zeroTargetsSec: 999 }), 'none');
eq('port down reason', why({ pageTargets: null, zeroTargetsSec: 999 }), 'port-down');

// normal cold start: port open, targets not yet there (measured 4-5s to first target)
eq('cold start 2s no dialog', act({ pageTargets: 0, zeroTargetsSec: 2 }), 'wait');
eq('cold start 6s no dialog, visible window', act({ pageTargets: 0, zeroTargetsSec: 6, visibleWindows: 1 }), 'wait');

// start-failure dialog is definitive, but only after the grace to avoid stale dialogs
eq('dialog at 5s (grace)', act({ pageTargets: 0, zeroTargetsSec: 5, dialog: true, visibleWindows: 1 }), 'wait');
eq('dialog at 12s -> repair', act({ pageTargets: 0, zeroTargetsSec: 12, dialog: true, visibleWindows: 1 }), 'repair');
eq('dialog reason', why({ pageTargets: 0, zeroTargetsSec: 12, dialog: true }), 'start-failure-dialog');
eq('dialog threshold', STUCK_DIALOG_MIN_SEC, 8);

// stuck without dialog, but with a visible window: needs the longer grace
eq('no dialog 60s visible', act({ pageTargets: 0, zeroTargetsSec: 60, visibleWindows: 1 }), 'wait');
eq('no dialog 95s visible -> repair', act({ pageTargets: 0, zeroTargetsSec: 95, visibleWindows: 1 }), 'repair');
eq('visible threshold', STUCK_VISIBLE_MIN_SEC, 90);

// stuck with NO window at all (hidden instance): only the hard limit fires
eq('no dialog 95s no window', act({ pageTargets: 0, zeroTargetsSec: 95, visibleWindows: 0 }), 'wait');
eq('no dialog 160s no window -> repair', act({ pageTargets: 0, zeroTargetsSec: 160, visibleWindows: 0 }), 'repair');
eq('hard threshold', STUCK_HARD_MIN_SEC, 150);

// cooldown wins over everything (prevents re-killing a freshly relaunched app)
eq('cooldown blocks dialog', act({ pageTargets: 0, zeroTargetsSec: 300, dialog: true, visibleWindows: 1, sinceRepairMs: 5000 }), 'none');
eq('cooldown reason', why({ pageTargets: 0, zeroTargetsSec: 300, dialog: true, sinceRepairMs: 5000 }), 'cooldown');
eq('after cooldown repairs', act({ pageTargets: 0, zeroTargetsSec: 300, dialog: true, visibleWindows: 1, sinceRepairMs: STUCK_REPAIR_COOLDOWN_MS + 1 }), 'repair');

// the watchdog's "port up but /json/list itself is unusable" rule (targets === null):
// it has no window evidence to lean on, so it uses this shorter threshold.
eq('list-fail threshold', STUCK_LIST_FAIL_SEC, 45);
eq('list-fail is shorter than the dialog rule', STUCK_LIST_FAIL_SEC > STUCK_DIALOG_MIN_SEC, true);
eq('list-fail is far shorter than the hard rule', STUCK_LIST_FAIL_SEC < STUCK_HARD_MIN_SEC, true);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
