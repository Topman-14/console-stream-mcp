import type { ScenarioGroup } from "./types";
import { consoleScenarios } from "./console";
import { errorScenarios } from "./errors";
import { networkScenarios } from "./network";
import { domScenarios } from "./dom";

// Add a new category by pushing another ScenarioGroup here — the ScenariosPage
// renders whatever's in this array, nothing else needs to change.
export const scenarioGroups: ScenarioGroup[] = [
  { category: "Console", scenarios: consoleScenarios },
  { category: "Errors", scenarios: errorScenarios },
  { category: "Network", scenarios: networkScenarios },
  { category: "DOM mutations", scenarios: domScenarios },
];

export type { Scenario, ScenarioGroup } from "./types";
