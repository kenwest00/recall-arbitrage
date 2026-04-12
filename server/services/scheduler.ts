/**
 * Scheduler Service
 * Manages the periodic recall data refresh using a simple interval-based approach.
 * The interval is configurable per user (stored in user_settings).
 * The global default is 24 hours.
 */

import { ingestAllRecalls } from "./recallIngestion";

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
  console.log(`[Scheduler] Starting recall ingestion at ${state.lastRunAt.toISOString()}`);

  try {
    const result = await ingestAllRecalls();
    console.log("[Scheduler] Ingestion complete:", result);
  } catch (err) {
    console.error("[Scheduler] Ingestion failed:", err);
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
 * Trigger an immediate ingestion run (outside the schedule).
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
