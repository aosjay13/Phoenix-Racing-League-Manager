"use client";

import { useMemo, useState } from "react";

// Shared column sorting for data tables.
// - First click on a column shows "best first" (desc for high-is-better,
//   asc for low-is-better metrics and text); clicking again flips it.
// - Null/empty values always sort last, in either direction.
// - Ties are settled by `tieBreak` when one is given, else they keep their
//   previous relative order (Array.sort is stable).
//
// `tieBreak` exists for championship tables: sorting by Points must put equal
// scores in the league's official order (Wins, Podiums, Top 5s… — see
// TIE_BREAKERS in lib/standings.js) rather than in whatever order the previous
// sort happened to leave them. It is applied in best-first direction whichever
// way the column itself is sorted, so the tied block reads as the standings do.
export function useSortable(rows, defaultKey, lowIsBetter = [], tieBreak = null) {
  const [sort, setSort] = useState({ key: defaultKey, asc: lowIsBetter.includes(defaultKey) });

  function clickSort(key, isText = false) {
    setSort(s =>
      s.key === key
        ? { key, asc: !s.asc }
        : { key, asc: isText || lowIsBetter.includes(key) }
    );
  }

  const sorted = useMemo(() => {
    if (!rows?.length) return [];
    const { key, asc } = sort;
    return [...rows].sort((a, b) => {
      const av = a[key], bv = b[key];
      const aNull = av == null || av === "";
      const bNull = bv == null || bv === "";
      if (aNull && bNull) return tieBreak ? tieBreak(a, b) : 0;
      if (aNull) return 1;
      if (bNull) return -1;
      let cmp;
      if (typeof av === "string" || typeof bv === "string") {
        cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      } else {
        cmp = av - bv;
      }
      if (cmp === 0 && tieBreak) return tieBreak(a, b);
      return asc ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, tieBreak]);

  const arrow = key => (sort.key === key ? (sort.asc ? " ▴" : " ▾") : "");

  return { sorted, sort, clickSort, arrow };
}
