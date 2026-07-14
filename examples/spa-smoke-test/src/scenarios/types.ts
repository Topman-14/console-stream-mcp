export interface Scenario {
  id: string;
  label: string;
  description: string;
  run: () => void | Promise<void>;
}

export interface ScenarioGroup {
  category: string;
  scenarios: Scenario[];
}
