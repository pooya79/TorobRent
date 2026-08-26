import { MapPin } from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";

import type { MapCoordinates } from "./adapter";

const TEHRAN_VIEWPORT = {
  north: 35.82,
  east: 51.6,
  south: 35.6,
  west: 51.15,
};
const KEYBOARD_STEP = 0.0001;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function ExactLocationPicker({
  value,
  onChange,
}: {
  value: MapCoordinates;
  onChange: (coordinates: MapCoordinates) => void;
}) {
  const horizontalPosition =
    ((value.longitude - TEHRAN_VIEWPORT.west) /
      (TEHRAN_VIEWPORT.east - TEHRAN_VIEWPORT.west)) *
    100;
  const verticalPosition =
    ((TEHRAN_VIEWPORT.north - value.latitude) /
      (TEHRAN_VIEWPORT.north - TEHRAN_VIEWPORT.south)) *
    100;
  const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const movement = {
      ArrowUp: { latitude: KEYBOARD_STEP, longitude: 0 },
      ArrowDown: { latitude: -KEYBOARD_STEP, longitude: 0 },
      ArrowRight: { latitude: 0, longitude: KEYBOARD_STEP },
      ArrowLeft: { latitude: 0, longitude: -KEYBOARD_STEP },
    }[event.key];
    if (!movement) return;
    event.preventDefault();
    onChange({
      latitude: Number((value.latitude + movement.latitude).toFixed(6)),
      longitude: Number((value.longitude + movement.longitude).toFixed(6)),
    });
  };
  const moveFromDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) return;
    const horizontal = clamp(
      (event.clientX - bounds.left) / bounds.width,
      0,
      1,
    );
    const vertical = clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    onChange({
      latitude: Number(
        (
          TEHRAN_VIEWPORT.north -
          vertical * (TEHRAN_VIEWPORT.north - TEHRAN_VIEWPORT.south)
        ).toFixed(6),
      ),
      longitude: Number(
        (
          TEHRAN_VIEWPORT.west +
          horizontal * (TEHRAN_VIEWPORT.east - TEHRAN_VIEWPORT.west)
        ).toFixed(6),
      ),
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">مکان دقیق روی نقشه</p>
      <div
        role="application"
        aria-label="نقشه انتخاب مکان دقیق"
        className="border-border bg-muted relative min-h-64 overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_center,var(--color-border)_1px,transparent_1px)] bg-size-[24px_24px]"
        onDragOver={(event) => event.preventDefault()}
      >
        <button
          type="button"
          draggable
          aria-label="پین مکان دقیق"
          className="bg-primary text-primary-foreground absolute grid size-12 -translate-x-1/2 -translate-y-full cursor-grab place-items-center rounded-full shadow-lg active:cursor-grabbing"
          style={{
            left: `${clamp(horizontalPosition, 0, 100)}%`,
            top: `${clamp(verticalPosition, 0, 100)}%`,
          }}
          onDragEnd={moveFromDrop}
          onKeyDown={moveWithKeyboard}
        >
          <MapPin aria-hidden="true" />
        </button>
      </div>
      <p className="text-muted-foreground text-xs">
        پین را بکشید یا با کلیدهای جهت جابه‌جا کنید. برای این انتخاب از تبدیل
        نشانی به مختصات استفاده نمی‌شود.
      </p>
    </div>
  );
}
