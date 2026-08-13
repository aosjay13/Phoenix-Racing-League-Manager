"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { canSeeApprovals } from "@/lib/pendingSignupAlerts";
import { MESSAGES_CHANGED_EVENT } from "@/components/MessagesProvider";

// The admin's half of the message board: every thread in the league, and how
// many of them have a player's reply nobody has answered.
//
// This is the counterpart to lib/pendingSignupAlerts.js, and it behaves the
// same way for the same reason. A player's reply is an outstanding job, not a
// notification: it stays on the Approvals badge until an admin answers it or
// marks it read, which is what makes the number mean something.
//
// It rides on the same permission floor as the approvals queue — Moderator and
// up. Below that no call is made at all, so a player's browser never asks the
// admin API for a league's correspondence.

const POLL_MS = 60_000;

export function useAdminMessages(roleLevel) {
  const allowed = canSeeApprovals(roleLevel);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!allowed) { setRows([]); return; }
    try {
      const res = await api("/api/admin/messages");
      setRows(Array.isArray(res) ? res : []);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [allowed]);

  useEffect(() => {
    load();
    if (!allowed) return undefined;
    function onVisible() { if (document.visibilityState === "visible") load(); }
    const timer = setInterval(load, POLL_MS);
    // Answering a thread fires this, so the badge drops as soon as the work is
    // done rather than up to a minute later.
    window.addEventListener(MESSAGES_CHANGED_EVENT, load);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener(MESSAGES_CHANGED_EVENT, load);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, allowed]);

  return { rows, error, reload: load };
}
