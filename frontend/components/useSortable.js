"use client";

import { useMemo, useState } from "react";

// Shared column sorting for data tables.
// - First click on a column shows "best first" (desc for high-is-better,
//   asc for low-is-better metrics and text); clicking again flips it.
// - Null/empty values always sort last, in either direction.
// - Ties keep their previous relative order (Array.sort is stable).
export function useSortable(rows, defaultKey, lowIsBetter = []) {
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
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      let cmp;
      if (typeof av === "string" || typeof bv === "string") {
        cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      } else {
        cmp = av - bv;
      }
      return asc ? cmp : -cmp;
    });
  }, [rows, sort]);

  const arrow = key => (sort.key === key ? (sort.asc ? " ▴" : " ▾") : "");

  return { sorted, sort, clickSort, arrow };
}
