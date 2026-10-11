interface Bounds { left: number; right: number; top: number; bottom: number }

export function alignedPopover(anchor: Bounds, popup: { width: number; height: number }, bounds: Bounds) {
  const maxHeight = Math.max(0, bounds.bottom - bounds.top);
  const height = Math.min(popup.height, maxHeight);
  const below = anchor.bottom + 8;
  const top = below + height <= bounds.bottom ? below : anchor.top - height - 8;
  return {
    left: Math.max(bounds.left, Math.min(anchor.right - popup.width, bounds.right - popup.width)),
    top: Math.max(bounds.top, Math.min(top, bounds.bottom - height)),
    maxHeight,
  };
}
