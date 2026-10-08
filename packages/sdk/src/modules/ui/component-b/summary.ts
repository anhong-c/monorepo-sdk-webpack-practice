import { add } from "@sdk/math";

export function createComponentBSummary(values: number[]): string {
  const total = values.reduce((sum, value) => add(sum, value), 0);

  return `Component B total: ${total}`;
}
