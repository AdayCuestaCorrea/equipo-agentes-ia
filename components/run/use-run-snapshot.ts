"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTerminal, loadSnapshot, type RunSnapshot } from "@/lib/runs/snapshot";
import { browserClient } from "@/lib/supabase/public";

export type LiveMode = "connecting" | "realtime" | "polling";

const POLL_MS = 3_000; // when Realtime is not connected
const SAFETY_POLL_MS = 20_000; // even with Realtime, in case an event is missed
const NUDGE_AFTER_MS = 60_000; // a run silent this long gets its step chain restarted

/**
 * Keeps a run snapshot fresh: Realtime (Postgres Changes) triggers a refetch; if the channel is
 * not connected it polls. Finished runs stop updating.
 */
export function useRunSnapshot(initial: RunSnapshot) {
  const runId = initial.run.id;
  const [snapshot, setSnapshot] = useState(initial);
  const [live, setLive] = useState<LiveMode>("connecting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finished = isTerminal(snapshot.run.status);

  const refresh = useCallback(async () => {
    try {
      const next = await loadSnapshot(browserClient(), runId);
      if (next) setSnapshot(next);
    } catch {
      // Transient network error: the next trigger or poll retries.
    }
  }, [runId]);

  // Coalesce bursts of changes (a step writes several rows) into one refetch.
  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(refresh, 250);
  }, [refresh]);

  useEffect(() => {
    if (finished) return;
    const db = browserClient();
    const byRun = `run_id=eq.${runId}`;
    const channel = db
      .channel(`run-${runId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "runs", filter: `id=eq.${runId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: byRun }, scheduleRefresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_events", filter: byRun }, scheduleRefresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_messages", filter: byRun }, scheduleRefresh)
      .subscribe((status) => {
        setLive(status === "SUBSCRIBED" ? "realtime" : "polling");
        if (status === "SUBSCRIBED") scheduleRefresh(); // catch up on anything before subscribing
      });
    return () => {
      void db.removeChannel(channel);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [finished, runId, scheduleRefresh]);

  useEffect(() => {
    if (finished) return;
    const id = setInterval(refresh, live === "realtime" ? SAFETY_POLL_MS : POLL_MS);
    return () => clearInterval(id);
  }, [finished, live, refresh]);

  // If the server-side step chain was lost (e.g. a cold start dropped a hop), restart it.
  const lastEventAt = snapshot.events.at(-1)?.createdAt ?? snapshot.run.createdAt;
  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => {
      if (Date.now() - new Date(lastEventAt).getTime() > NUDGE_AFTER_MS) {
        void fetch(`/api/runs/${runId}/step`, { method: "POST" }).catch(() => {});
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [finished, lastEventAt, runId]);

  return { snapshot, live: finished ? ("realtime" as LiveMode) : live };
}
