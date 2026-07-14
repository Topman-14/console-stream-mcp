import { useEffect, useState } from "react";
import { useTheme } from "../../hooks/use-theme.js";
import { useSyncedSetting } from "../../hooks/use-setting.js";
import { generalSettings, performanceSettings, mcpSettings, debugSettings } from "../../lib/settings.js";
import { captureOptionsSetting, privacyOptionsSetting, type CaptureOptions, type PrivacyOptions } from "../../lib/capture-options.js";
import { getRules, setRules, type CaptureRule } from "../../lib/rules.js";
import { SettingRow } from "../../components/ui/setting-row.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { Separator } from "../../components/ui/separator.js";
import { cn } from "../../lib/utils.js";
import { COMING_SOON, THEME_OPTIONS, CAPTURE_ROWS, PRIVACY_ROWS, EXPERIMENTAL_ROWS, ABOUT_LINKS, QUICK_PATTERNS } from "./data.js";
import { DownloadIcon, PlusIcon, TrashIcon, ArrowSquareOutIcon, InfinityIcon } from "@phosphor-icons/react";

export function Options() {
  const [theme, setTheme] = useTheme();
  const [general, updateGeneral] = useSyncedSetting(generalSettings);
  const [captureOptions, updateCaptureOptions] = useSyncedSetting(captureOptionsSetting);
  const [privacyOptions, updatePrivacyOptions] = useSyncedSetting(privacyOptionsSetting);
  const [performance, updatePerformance] = useSyncedSetting(performanceSettings);
  const [mcp, updateMcp] = useSyncedSetting(mcpSettings);
  const [debug, updateDebug] = useSyncedSetting(debugSettings);
  const [exporting, setExporting] = useState(false);

  const [rules, setRulesState] = useState<CaptureRule[]>([]);
  const [pattern, setPattern] = useState("");
  const refreshRules = () => getRules().then(setRulesState);

  useEffect(() => {
    refreshRules();
  }, []);

  const updateCapture = (key: keyof CaptureOptions, value: boolean) => updateCaptureOptions({ [key]: value } as Partial<CaptureOptions>);
  const updatePrivacy = (key: keyof PrivacyOptions, value: boolean) => updatePrivacyOptions({ [key]: value } as Partial<PrivacyOptions>);

  const exportDiagnostics = async () => {
    setExporting(true);
    await chrome.runtime.sendMessage({ type: "mobius-mcp/export-diagnostics" });
    setExporting(false);
  };

  const addPattern = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || rules.some((r) => r.pattern === trimmed)) return;
    const rule: CaptureRule = { id: crypto.randomUUID(), pattern: trimmed };
    await setRules([...(await getRules()), rule]);
    refreshRules();
  };

  const removeRule = async (id: string) => {
    await setRules((await getRules()).filter((r) => r.id !== id));
    refreshRules();
  };

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold">
        <InfinityIcon size={32} weight="bold" className="text-primary" />
        Mobius
      </h1>
      <p className="mt-1 text-muted-foreground">Settings for capture behavior, privacy, and the local MCP connection.</p>

      <div className="mt-6 flex flex-col gap-8">
        {/* General */}
        <section>
          <h2 className="font-semibold text-xl">General</h2>
          <Separator className="mt-2" />
          <div className="flex flex-col divide-y divide-border">
            <div className="py-2.5">
              <div className="mb-2 font-medium">Theme</div>
              <div className="grid grid-cols-3 gap-2">
                {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <Button
                    key={value}
                    variant={theme === value ? "secondary" : "outline"}
                    onClick={() => setTheme(value)}
                    className={cn("h-auto flex-col gap-1.5 py-2.5", theme === value && "border-primary")}
                  >
                    <Icon size={16} weight={theme === value ? "fill" : "regular"} />
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <SettingRow
              label="Error notifications"
              description="Show a system notification when a runtime error is captured"
              checked={general?.notifications ?? false}
              onCheckedChange={(v) => updateGeneral({ notifications: v })}
            />
          </div>
        </section>

        {/* Capture */}
        <section>
          <h2 className="font-semibold text-xl">Capture</h2>
          <Separator className="mt-2" />
          {captureOptions && (
            <div className="flex flex-col divide-y divide-border">
              {CAPTURE_ROWS.map(({ key, label, description }) => (
                <SettingRow key={key} label={label} description={description} checked={captureOptions[key]} onCheckedChange={(v) => updateCapture(key, v)} />
              ))}
              {/*TODO: implement these*/}
              <SettingRow label="Performance metrics" description="Requires a performance capture hook, not built yet" checked={false} onCheckedChange={() => {}} disabled badge={COMING_SOON} />
              <SettingRow label="Storage changes" description="Requires a storage capture hook, not built yet" checked={false} onCheckedChange={() => {}} disabled badge={COMING_SOON} />
            </div>
          )}
        </section>

        {/* Auto-enable rules */}
        <section>
          <h2 className="font-semibold text-xl">Auto-enable rules</h2>
          <Separator className="mt-2" />
          <div className="flex flex-col gap-4 py-2.5">
            <p className="text-sm text-muted-foreground">
              Tabs matching a rule auto-enable capture on navigation, without clicking the toolbar icon. Pattern format is{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">hostname:port</code>, e.g. <code className="rounded bg-muted px-1 py-0.5 font-mono">localhost:5173</code> or{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">localhost:*</code>.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {QUICK_PATTERNS.filter((p) => !rules.some((r) => r.pattern === p)).map((p) => (
                <Button key={p} variant="outline" size="sm" onClick={() => addPattern(p)} className="rounded-none font-mono">
                  <PlusIcon size={10} />
                  {p}
                </Button>
              ))}
            </div>

            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {rules.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">No rules yet</li>}
              {rules.map((rule) => (
                <li key={rule.id} className="flex items-center justify-between px-3 py-2">
                  <span className="font-mono text-sm">{rule.pattern}</span>
                  <Button variant="ghost" size="icon-sm" onClick={() => removeRule(rule.id)} className="hover:text-destructive" aria-label={`Remove ${rule.pattern}`}>
                    <TrashIcon size={13} />
                  </Button>
                </li>
              ))}
            </ul>

            <div className="flex gap-2">
              <Input
                placeholder="localhost:5173"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  addPattern(pattern);
                  setPattern("");
                }}
              />
              <Button
                onClick={() => {
                  addPattern(pattern);
                  setPattern("");
                }}
              >
              <PlusIcon size={16} weight="bold" />
              </Button>
            </div>
          </div>
        </section>

        {/* Privacy */}
        <section>
          <h2 className="font-semibold text-xl">Privacy</h2>
          <Separator className="mt-2" />
          {privacyOptions && (
            <div className="flex flex-col divide-y divide-border">
              {PRIVACY_ROWS.map(({ key, label, description }) => (
                <SettingRow key={key} label={label} description={description} checked={privacyOptions[key]} onCheckedChange={(v) => updatePrivacy(key, v)} />
              ))}
              <SettingRow label="Redact localStorage" description="Requires a storage capture hook, not built yet" checked={false} onCheckedChange={() => {}} disabled badge={COMING_SOON} />
            </div>
          )}
        </section>

        {/* Performance */}
        <section>
          <h2 className="font-semibold text-xl">Performance</h2>
          <Separator className="mt-2" />
          {performance && (
            <div className="flex flex-col divide-y divide-border">
              <div className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <div className="font-medium">Queued event buffer</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">Max events held while the MCP server is unreachable</div>
                </div>
                <Input type="number" min={50} max={5000} className="w-24 text-right" value={performance.bufferSize} onChange={(e) => updatePerformance({ bufferSize: Number(e.target.value) })} />
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <div className="font-medium">Auto-clear interval</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">Minutes between automatic clears of popup counters and feed</div>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={180}
                  className="w-24 text-right"
                  value={performance.autoClearMinutes}
                  onChange={(e) => updatePerformance({ autoClearMinutes: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
        </section>

        {/* MCP connection */}
        <section>
          <h2 className="font-semibold text-xl">MCP connection</h2>
          <Separator className="mt-2" />
          {mcp && (
            <div className="flex flex-col divide-y divide-border">
              <div className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <div className="font-medium">WebSocket port</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">ws://localhost:{mcp.port}, must match the running mobius-mcp server</div>
                </div>
                <Input type="number" min={1024} max={65535} className="w-24 text-right" value={mcp.port} onChange={(e) => updateMcp({ port: Number(e.target.value) })} />
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <div className="font-medium">Reconnect base delay</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">Milliseconds before the first retry; backs off exponentially up to 10s</div>
                </div>
                <Input
                  type="number"
                  min={100}
                  max={5000}
                  step={100}
                  className="w-24 text-right"
                  value={mcp.reconnectBaseDelayMs}
                  onChange={(e) => updateMcp({ reconnectBaseDelayMs: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
        </section>

        {/* Debug */}
        <section>
          <h2 className="font-semibold text-xl">Debug</h2>
          <Separator className="mt-2" />
          {debug && (
            <div className="flex flex-col divide-y divide-border">
              <SettingRow
                label="Verbose extension logs"
                description="Log connection and tab lifecycle events to the service worker console"
                checked={debug.verboseLogs}
                onCheckedChange={(v) => updateDebug({ verboseLogs: v })}
              />
              <div className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <div className="font-medium">Export diagnostics</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">Downloads connection state and per-tab counters as JSON</div>
                </div>
                <Button variant="outline" size="sm" onClick={exportDiagnostics} disabled={exporting}>
                  <DownloadIcon size={13} />
                  {exporting ? "Exporting…" : "Export"}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Experimental */}
        <section>
          <h2 className="font-semibold text-xl">Experimental</h2>
          <Separator className="mt-2" />
          <div className="flex flex-col divide-y divide-border">
            {EXPERIMENTAL_ROWS.map(({ label, description }) => (
              <SettingRow key={label} label={label} description={description} checked={false} onCheckedChange={() => {}} disabled badge={COMING_SOON} />
            ))}
          </div>
        </section>

        {/* About */}
        <section>
          <h2 className="font-semibold text-xl">About</h2>
          <Separator className="mt-2" />
          <div className="flex flex-col gap-4 py-2.5">
            <div>
              <div className="font-medium">{chrome.runtime.getManifest().name}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">Version {chrome.runtime.getManifest().version}</div>
            </div>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {ABOUT_LINKS.map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noreferrer" className="flex items-center justify-between px-3 py-2 transition-colors hover:bg-accent">
                    {link.label}
                    <ArrowSquareOutIcon size={13} className="text-muted-foreground" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
