/**
 * Application startup tasks.
 * Called once when the server boots.
 */

import { startScheduler } from "../services/scheduler";

export async function runStartupTasks(): Promise<void> {
  console.log("[Startup] Initializing RecallArb services...");

  // Start the recall data refresh scheduler (default: every 24 hours)
  startScheduler(24);

  console.log("[Startup] Scheduler started. Recall data will refresh every 24 hours.");
}
