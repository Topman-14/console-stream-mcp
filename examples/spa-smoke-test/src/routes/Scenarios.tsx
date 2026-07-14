import { scenarioGroups } from "../scenarios";

export function Scenarios() {
  return (
    <div>
      <h2>Scenarios</h2>
      <p>
        Grouped by capture category. Add more by editing <code>src/scenarios/*.ts</code> — each file exports a list of <code>Scenario</code> objects, and{" "}
        <code>src/scenarios/index.ts</code> is the only place new categories need to be registered.
      </p>
      {scenarioGroups.map((group) => (
        <section key={group.category}>
          <h3>{group.category}</h3>
          <ul className="scenario-list">
            {group.scenarios.map((scenario) => (
              <li key={scenario.id} title={scenario.description}>
                <button onClick={() => scenario.run()}>{scenario.label}</button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
