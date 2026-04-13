/**
 * Scheduler Service
 * Manages the periodic recall data refresh using a simple interval-based approach.
 * The interval is configurable per user (stored in user_settings).
 * The global default is 24 hours.
 *
 * Full pipeline on each run:
 *   1. Ingest recalls from CPSC + NHTSA
 *   2. Fetch market pricing for each active recall (eBay, Amazon, Facebook, Craigslist / auto parts)
 *   3. Calculate profit analysis for each recall
 */

import { ingestAllRecalls } from "./recallIngestion";
import { refreshAllProfitAnalysis } from "./profitEngine";

interface SchedulerState {
  timer: ReturnType<typeof setInterval> | null;
  intervalHours: number;
  lastRunAt: Date | null;
  isRunning: boolean;
  nextRunAt: Date | null;
}

const state: SchedulerState = {
  timer: null,
  intervalHours: 24,
  lastRunAt: null,
  isRunning: false,
  nextRunAt: null,
};

function computeNextRun(intervalHours: number): Date {
  return new Date(Date.now() + intervalHours * 60 * 60 * 1000);
}

async function runIngestion(): Promise<void> {
  if (state.isRunning) {
    console.log("[Scheduler] Ingestion already running, skipping.");
    return;
  }

  state.isRunning = true;
  state.lastRunAt = new Date();
  console.log(`[Scheduler] Starting full sync pipeline at ${state.lastRunAt.toISOString()}`);

  try {
    // Step 1: Ingest recalls from CPSC + NHTSA
    const result = await ingestAllRecalls();
    console.log("[Scheduler] Recall ingestion complete:", result);

    // Step 2 + 3: Fetch market pricing and calculate profit analysis for all active recalls
    console.log("[Scheduler] Starting market pricing and profit analysis...");
    await refreshAllProfitAnalysis();
    console.log("[Scheduler] Profit analysis complete.");
  } catch (err) {
    console.error("[Scheduler] Full sync pipeline failed:", err);
  } finally {
    state.isRunning = false;
    state.nextRunAt = computeNextRun(state.intervalHours);
  }
}

/**
 * Start the scheduler with the given interval (in hours).
 * Calling this again will restart with the new interval.
 */
export function startScheduler(intervalHours = 24): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }

  state.intervalHours = intervalHours;
  state.nextRunAt = computeNextRun(intervalHours);

  const intervalMs = intervalHours * 60 * 60 * 1000;
  state.timer = setInterval(runIngestion, intervalMs);

  console.log(`[Scheduler] Started with ${intervalHours}h interval. Next run: ${state.nextRunAt.toISOString()}`);
}

/**
 * Stop the scheduler.
 */
export function stopScheduler(): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.nextRunAt = null;
  console.log("[Scheduler] Stopped.");
}

/**
 * Trigger an immediate full sync run (outside the schedule).
 * Runs: recall ingestion → market pricing → profit analysis
 */
export async function triggerImmediateSync(): Promise<void> {
  await runIngestion();
  // Reset the timer so the next scheduled run is from now
  if (state.timer) {
    startScheduler(state.intervalHours);
  }
}

/**
 * Get current scheduler status.
 */
export function getSchedulerStatus(): {
  isRunning: boolean;
  intervalHours: number;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  isScheduled: boolean;
} {
  return {
    isRunning: state.isRunning,
    intervalHours: state.intervalHours,
    lastRunAt: state.lastRunAt,
    nextRunAt: state.nextRunAt,
    isScheduled: state.timer !== null,
  };
}

/**
 * Update the scheduler interval (restarts if currently running).
 */
export function updateSchedulerInterval(newIntervalHours: number): void {
  if (newIntervalHours < 1) throw new Error("Interval must be at least 1 hour");
  if (state.timer) {
    startScheduler(newIntervalHours);
  } else {
    state.intervalHours = newIntervalHours;
    state.nextRunAt = null;
  }
}
