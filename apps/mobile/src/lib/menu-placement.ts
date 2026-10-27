/** Places a menu under its anchor, aligned to the anchor's nearer edge and kept inside the overlay. */
export function deriveMenuHorizontalPlacement(input: {
  readonly anchorX: number;
  readonly anchorWidth: number;
  readonly overlayWidth: number;
  readonly desiredWidth: number;
  readonly margin: number;
}) {
  const center = input.anchorX + input.anchorWidth / 2;
  const width = Math.min(input.desiredWidth, Math.max(0, input.overlayWidth - 2 * input.margin));

  const preferredLeft =
    center <= input.overlayWidth / 2 ? input.anchorX : input.anchorX + input.anchorWidth - width;

  const left = Math.min(
    Math.max(preferredLeft, input.margin),
    input.overlayWidth - width - input.margin,
  );

  return { left, width };
}
