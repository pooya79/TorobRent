import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

export function PageMain({
  className,
  ...props
}: ComponentPropsWithoutRef<"main">) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={cn(
        "mx-auto w-full max-w-432 px-4 py-8 sm:px-6 lg:px-10",
        className,
      )}
      {...props}
    />
  );
}
