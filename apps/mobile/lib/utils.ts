import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Standard React Native Reusables cn helper (shadcn/ui style).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
