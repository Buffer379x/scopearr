export function scanCoverageReason(root: {
  items: number;
  scanned?: number;
  unselected?: number;
  outside_share?: number;
}) {
  const unselected = root.unselected || 0,
    outside = root.outside_share || 0;
  const path = Math.max(
    0,
    root.items - (root.scanned || 0) - unselected - outside,
  );
  if (unselected > 0 && unselected >= outside && unselected >= path)
    return "Instance not selected";
  return outside > 0 && outside >= path ? "Outside the share" : "Path warning";
}
