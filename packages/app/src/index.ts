import { createComponentALabel } from "@practice/sdk/component-a";
import { createComponentBSummary } from "@practice/sdk/component-b";

const values = [18, 25, 32];

console.log(createComponentALabel("legacy monorepo app"));
console.log(createComponentBSummary(values));
