import { MapPin } from "lucide-react";
import {
  Suspense,
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import type { MapCoordinates, MapViewport } from "./adapter";
import { configuredMapAdapter } from "./configured-adapter";

const KEYBOARD_STEP = 0.0001;

function initialViewport(value: MapCoordinates): MapViewport {
  return {
    north: value.latitude + 0.03,
    east: value.longitude + 0.04,
    south: value.latitude - 0.03,
    west: value.longitude - 0.04,
    zoom: 15,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function coordinatesAtPoint(
  clientX: number,
  clientY: number,
  bounds: DOMRect,
  viewport: MapViewport,
): MapCoordinates | null {
  if (bounds.width === 0 || bounds.height === 0) return null;
  const horizontal = clamp((clientX - bounds.left) / bounds.width, 0, 1);
  const vertical = clamp((clientY - bounds.top) / bounds.height, 0, 1);
  return {
    latitude: Number(
      (viewport.north - vertical * (viewport.north - viewport.south)).toFixed(
        6,
      ),
    ),
    longitude: Number(
      (viewport.west + horizontal * (viewport.east - viewport.west)).toFixed(6),
    ),
  };
}

export function ExactLocationPicker({
  value,
  onChange,
}: {
  value: MapCoordinates;
  onChange: (coordinates: MapCoordinates) => void;
}) {
  const [viewport, setViewport] = useState(() => initialViewport(value));
  const [providerUnavailable, setProviderUnavailable] = useState(false);
  const pointerDragging = useRef(false);
  const onReady = useCallback(() => setProviderUnavailable(false), []);
  const onProviderError = useCallback(() => {
    setProviderUnavailable(true);
  }, []);
  const ignoreProperty = useCallback(() => undefined, []);
  const horizontalPosition =
    ((value.longitude - viewport.west) / (viewport.east - viewport.west)) * 100;
  const verticalPosition =
    ((viewport.north - value.latitude) / (viewport.north - viewport.south)) *
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
  const moveFromClientPoint = (
    clientX: number,
    clientY: number,
    pin: HTMLButtonElement,
  ) => {
    const bounds = pin.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    const coordinates = coordinatesAtPoint(clientX, clientY, bounds, viewport);
    if (coordinates) onChange(coordinates);
  };
  const moveFromDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    moveFromClientPoint(event.clientX, event.clientY, event.currentTarget);
  };
  const moveFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
    if (!pointerDragging.current) return;
    moveFromClientPoint(event.clientX, event.clientY, event.currentTarget);
  };

  const MapAdapterComponent = configuredMapAdapter;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">مکان دقیق روی نقشه</p>
      <div
        aria-label="نقشه انتخاب مکان دقیق"
        className="border-border bg-muted relative min-h-64 overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_center,var(--color-border)_1px,transparent_1px)] bg-size-[24px_24px]"
        onDragOver={(event) => event.preventDefault()}
      >
        <div className="absolute inset-0">
          <Suspense fallback={null}>
            <MapAdapterComponent
              initialViewport={viewport}
              markers={[]}
              clusters={[]}
              selectedPropertyId={null}
              retryToken={0}
              onReady={onReady}
              onError={onProviderError}
              onViewportChange={setViewport}
              onSelectProperty={ignoreProperty}
              onPreviewProperty={ignoreProperty}
              onSelectCluster={ignoreProperty}
            />
          </Suspense>
        </div>
        <button
          type="button"
          draggable
          aria-label="پین مکان دقیق"
          className="bg-primary text-primary-foreground absolute z-10 grid size-12 -translate-x-1/2 -translate-y-full cursor-grab touch-none place-items-center rounded-full shadow-lg active:cursor-grabbing"
          style={{
            left: `${clamp(horizontalPosition, 0, 100)}%`,
            top: `${clamp(verticalPosition, 0, 100)}%`,
          }}
          onDragEnd={moveFromDrop}
          onKeyDown={moveWithKeyboard}
          onPointerDown={(event) => {
            pointerDragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={moveFromPointer}
          onPointerUp={() => {
            pointerDragging.current = false;
          }}
          onPointerCancel={() => {
            pointerDragging.current = false;
          }}
        >
          <MapPin aria-hidden="true" />
        </button>
        {providerUnavailable && (
          <p className="bg-background/90 absolute end-2 bottom-2 rounded px-2 py-1 text-xs">
            پس‌زمینه نقشه در دسترس نیست؛ پین همچنان با مختصات دستی جابه‌جا
            می‌شود.
          </p>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        پین را بکشید یا با کلیدهای جهت جابه‌جا کنید. برای این انتخاب از تبدیل
        نشانی به مختصات استفاده نمی‌شود.
      </p>
    </div>
  );
}
