"use client";

import { useEffect } from "react";
import { useAppDispatch } from "@/lib/store/hooks";
import { realtimeStarted, realtimeStopped } from "@/lib/store/slices/realtime";

/** Keeps the real-time stream (`/api/stream`) open while any signed-in screen is mounted. */
export function RealtimeConnection() {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(realtimeStarted());
    return () => {
      dispatch(realtimeStopped());
    };
  }, [dispatch]);
  return null;
}
