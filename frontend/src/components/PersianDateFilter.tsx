import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  addCalendarDays,
  adjacentPersianMonth,
  calendarDay,
  calendarDayBoundary,
  persianDateFormatter,
  persianDayNumber,
  persianMonthFormatter,
  persianMonthStart,
} from "@/lib/dates/persian-calendar";

function PersianCalendar({
  selected,
  onSelect,
}: {
  selected?: Date;
  onSelect: (date: Date) => void;
}) {
  const today = calendarDay(new Date());
  const [month, setMonth] = useState(() =>
    persianMonthStart(selected ?? today),
  );
  const [focusDay, setFocusDay] = useState<Date>();
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const nextMonth = adjacentPersianMonth(month, 1);
  const offset = (month.getUTCDay() + 1) % 7;
  const dayCount = Math.round(
    (nextMonth.getTime() - month.getTime()) / 86_400_000,
  );
  const weeks = Math.ceil((offset + dayCount) / 7);
  useEffect(() => {
    if (focusDay) buttons.current.get(focusDay.getTime())?.focus();
  }, [focusDay]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="ماه قبل"
          onClick={() => setMonth(adjacentPersianMonth(month, -1))}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <p className="font-semibold" aria-live="polite">
          {persianMonthFormatter.format(month)}
        </p>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="ماه بعد"
          onClick={() => setMonth(nextMonth)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
      </div>
      <table
        className="w-full table-fixed border-collapse"
        aria-label={persianMonthFormatter.format(month)}
      >
        <thead>
          <tr>
            {[
              "شنبه",
              "یکشنبه",
              "دوشنبه",
              "سه‌شنبه",
              "چهارشنبه",
              "پنجشنبه",
              "جمعه",
            ].map((day) => (
              <th
                scope="col"
                className="text-muted-foreground h-10 text-[10px] font-normal"
                key={day}
              >
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: weeks }, (_, week) => (
            <tr key={week}>
              {Array.from({ length: 7 }, (_, weekday) => {
                const index = week * 7 + weekday - offset;
                if (index < 0 || index >= dayCount) return <td key={weekday} />;
                const date = addCalendarDays(month, index);
                const isSelected = date.getTime() === selected?.getTime();
                const isToday = date.getTime() === today.getTime();
                return (
                  <td key={weekday} className="p-0.5 text-center">
                    <button
                      type="button"
                      ref={(node) => {
                        if (node) buttons.current.set(date.getTime(), node);
                        else buttons.current.delete(date.getTime());
                      }}
                      className={cn(
                        "hover:bg-muted focus-visible:ring-ring mx-auto flex aspect-square w-full max-w-11 items-center justify-center rounded-xl text-sm focus-visible:ring-2 focus-visible:outline-none",
                        isSelected &&
                          "bg-primary text-primary-foreground hover:bg-primary/90",
                        isToday &&
                          !isSelected &&
                          "text-primary ring-primary/30 font-bold ring-1",
                      )}
                      aria-label={persianDateFormatter.format(date)}
                      aria-pressed={isSelected}
                      aria-current={isToday ? "date" : undefined}
                      onClick={() => onSelect(date)}
                      onKeyDown={(event) => {
                        const movement: Record<string, number> = {
                          ArrowRight: -1,
                          ArrowLeft: 1,
                          ArrowUp: -7,
                          ArrowDown: 7,
                        };
                        const amount = movement[event.key];
                        if (amount === undefined) return;
                        event.preventDefault();
                        const next = addCalendarDays(date, amount);
                        setMonth(persianMonthStart(next));
                        setFocusDay(next);
                      }}
                    >
                      {persianDayNumber(date).toLocaleString("fa-IR")}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => onSelect(today)}
      >
        امروز
      </Button>
    </div>
  );
}

export function PersianDateFilter({
  label,
  value,
  boundary,
  onChange,
}: {
  label: string;
  value?: string;
  boundary: "start" | "end";
  onChange: (value: string | undefined) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const selected = value ? calendarDay(new Date(value)) : undefined;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className="w-full justify-between rounded-xl font-normal"
          >
            <span className={value ? "" : "text-muted-foreground"}>
              {selected
                ? persianDateFormatter.format(selected)
                : "انتخاب تاریخ شمسی"}
            </span>
            <CalendarDays
              className="text-muted-foreground size-4"
              aria-hidden="true"
            />
          </Button>
        </DialogTrigger>
        <DialogContent
          dir="rtl"
          className="max-h-[90dvh] max-w-sm overflow-y-auto p-5"
        >
          <div className="space-y-2 pe-10 text-start">
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>
              تقویم هجری شمسی · به وقت تهران
            </DialogDescription>
          </div>
          <PersianCalendar
            selected={selected}
            onSelect={(day) => {
              onChange(calendarDayBoundary(day, boundary));
              setOpen(false);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            پاک کردن تاریخ
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
