import {
  fitBands,
  fitBandLabels,
  fitStarSymbol,
} from "@/features/catalog/preferences";
import { fitAppearance } from "./fit-appearance";

export function PreferenceMapLegend() {
  return (
    <details
      className="bg-background/95 absolute start-2 bottom-10 z-10 max-w-[calc(100%-1rem)] rounded-xl border p-3 text-xs shadow-sm"
      aria-label="راهنمای تناسب با ترجیحات"
    >
      <summary className="cursor-pointer font-semibold">
        تناسب با ترجیحات شما · ۱ تا ۵ ستاره
      </summary>
      <ul className="mt-3 space-y-2">
        {fitBands.map((band) => {
          const appearance = fitAppearance(band, false);
          const shape = appearance.shape;
          return (
            <li key={band} className="flex items-center gap-2">
              <svg
                viewBox="-20 -20 40 40"
                className="size-8 shrink-0"
                aria-hidden="true"
              >
                <g
                  fill={appearance.fill}
                  stroke={appearance.outline}
                  strokeWidth="2"
                >
                  {shape === "star" ? (
                    <path d="M0,-18 5.88,-8.09 17.12,-5.56 9.51,3.09 10.58,14.56 0,10 -10.58,14.56 -9.51,3.09 -17.12,-5.56 -5.88,-8.09Z" />
                  ) : shape === "diamond" ? (
                    <path d="M0,-15 15,0 0,15 -15,0Z" />
                  ) : shape === "square" ? (
                    <rect x="-10.6" y="-10.6" width="21.2" height="21.2" />
                  ) : (
                    <circle r="11" />
                  )}
                </g>
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={appearance.textColor}
                  fontSize="12"
                  fontWeight="700"
                >
                  {appearance.number}
                </text>
              </svg>
              <span className="flex-1">{fitBandLabels[band]}</span>
              <span
                dir="ltr"
                className="text-amber-700 dark:text-amber-400"
                aria-label={`${appearance.number} از ۵ ستاره`}
              >
                {fitStarSymbol(band)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground mt-2 max-w-64 leading-5">
        ؟ یعنی اطلاعات کافی نداریم. عدد کنار ★ در گروه‌ها، تعداد ملک‌های ۵ ستاره
        است.
      </p>
    </details>
  );
}
