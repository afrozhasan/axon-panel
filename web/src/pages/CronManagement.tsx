import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Badge, Button, Card, Spinner, useAsyncAction, useToast } from "../components/ui";

type CronJob = {
  id: string;
  user: string;
  schedule: string;
  command: string;
  minute: string;
  hour: string;
  dom: string;
  month: string;
  dow: string;
};

type RunResult = {
  ok: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
};

const PRESETS = [
  { label: "Every minute", value: "* * * * *" },
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Daily (Midnight)", value: "0 0 * * *" },
  { label: "Daily (3:00 AM)", value: "0 3 * * *" },
  { label: "Weekly (Sunday)", value: "0 0 * * 0" },
];

export default function CronManagement() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [users, setUsers] = useState<string[]>(["www-data", "root"]);
  const [filterUser, setFilterUser] = useState<string>("all");

  // Add job modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUser, setNewUser] = useState("www-data");
  const [newSchedule, setNewSchedule] = useState("* * * * *");
  const [newCommand, setNewCommand] = useState("");

  // Run output modal
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);

  const { busy, run } = useAsyncAction();
  const toast = useToast();

  const loadJobs = async () => {
    try {
      const res = await api.get<{ jobs: CronJob[]; users: string[] }>("/cron");
      setJobs(res.jobs);
      setUsers(res.users);
    } catch (e: any) {
      toast("error", e.message || "Failed to load cron jobs");
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  const handleAddJob = () => {
    if (!newSchedule.trim() || !newCommand.trim()) return;
    run(async () => {
      await api.post("/cron", {
        user: newUser,
        schedule: newSchedule.trim(),
        command: newCommand.trim(),
      });
      setShowAddModal(false);
      setNewCommand("");
      await loadJobs();
    }, "Cron job created successfully");
  };

  const handleDeleteJob = (job: CronJob) => {
    if (!confirm(`Delete cron job: ${job.schedule} ${job.command}?`)) return;
    const parts = job.id.split("-");
    const user = parts[0];
    const index = parts[1];

    run(async () => {
      await api.delete(`/cron/${user}/${index}`);
      await loadJobs();
    }, "Cron job deleted");
  };

  const handleRunNow = async (job: CronJob) => {
    setRunningJobId(job.id);
    try {
      const res = await api.post<RunResult>("/cron/run-now", {
        user: job.user,
        command: job.command,
      });
      setRunResult(res);
    } catch (e: any) {
      toast("error", e.message || "Failed to execute cron job");
    } finally {
      setRunningJobId(null);
    }
  };

  const filteredJobs = filterUser === "all" ? jobs : jobs.filter((j) => j.user === filterUser);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--axon-border)] pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span className="text-2xl">⏱️</span> Scheduled Tasks & Cron Jobs
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Manage Linux crontabs for application background runners (e.g. Laravel artisan schedule:run) and maintenance jobs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={() => setShowAddModal(true)}>
            + Add Cron Job
          </Button>
        </div>
      </div>

      {/* Main Card */}
      <Card
        title="Active Cron Tasks"
        subtitle={`${filteredJobs.length} scheduled jobs`}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Filter User:</span>
            <select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2 py-1 text-xs text-slate-300 focus:outline-none"
            >
              <option value="all">All Users</option>
              {users.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <Button size="sm" variant="secondary" onClick={loadJobs}>
              Refresh
            </Button>
          </div>
        }
      >
        {filteredJobs.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No active cron jobs found. Click "+ Add Cron Job" to create a scheduled task.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--axon-border)] text-slate-400">
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">Schedule</th>
                  <th className="pb-2 font-medium">Command</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1f2839]/60">
                {filteredJobs.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-900/40">
                    <td className="py-3">
                      <Badge tone={j.user === "root" ? "warn" : "info"}>{j.user}</Badge>
                    </td>
                    <td className="py-3">
                      <span className="font-mono text-emerald-400 font-semibold">{j.schedule}</span>
                    </td>
                    <td className="py-3 font-mono text-slate-300 truncate max-w-[420px]" title={j.command}>
                      {j.command}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleRunNow(j)}
                          disabled={runningJobId === j.id}
                        >
                          {runningJobId === j.id ? <Spinner /> : "Run Now"}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDeleteJob(j)}
                          disabled={busy}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5 shadow-2xl">
            <h3 className="text-base font-bold text-slate-100">Add New Scheduled Task</h3>

            <div className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Execute as User</label>
                <select
                  value={newUser}
                  onChange={(e) => setNewUser(e.target.value)}
                  className="w-full rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-3 py-2 text-slate-200 focus:outline-none"
                >
                  <option value="www-data">www-data (Standard for web & Laravel tasks)</option>
                  <option value="root">root (System administrator tasks)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Schedule Presets</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setNewSchedule(p.value)}
                      className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                        newSchedule === p.value
                          ? "bg-indigo-600 text-white"
                          : "border border-[var(--axon-border)] bg-[#121929] text-slate-300 hover:text-white"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={newSchedule}
                  onChange={(e) => setNewSchedule(e.target.value)}
                  placeholder="* * * * *"
                  className="mono w-full rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-3 py-2 text-emerald-400 font-semibold focus:outline-none"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Format: minute (0-59) hour (0-23) day-of-month (1-31) month (1-12) day-of-week (0-6)
                </span>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Command</label>
                <input
                  type="text"
                  value={newCommand}
                  onChange={(e) => setNewCommand(e.target.value)}
                  placeholder="cd /var/www/example.com && php artisan schedule:run"
                  className="mono w-full rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-3 py-2 text-slate-200 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleAddJob} disabled={!newCommand.trim() || busy}>
                Create Job
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Execution Output Modal */}
      {runResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--axon-border)]">
              <div className="flex items-center gap-2">
                <Badge tone={runResult.ok ? "ok" : "bad"}>
                  {runResult.ok ? "Success (Code 0)" : `Failed (Code ${runResult.exitCode})`}
                </Badge>
                <span className="text-xs text-slate-400">Duration: {runResult.durationMs}ms</span>
              </div>
              <button
                onClick={() => setRunResult(null)}
                className="text-slate-400 hover:text-slate-200 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <span className="text-[11px] font-semibold text-slate-400">Standard Output (stdout):</span>
                <pre className="mono mt-1 max-h-48 overflow-y-auto rounded bg-[var(--axon-input-bg)] p-2.5 text-[11px] text-slate-300">
                  {runResult.stdout || "(empty)"}
                </pre>
              </div>

              {runResult.stderr && (
                <div>
                  <span className="text-[11px] font-semibold text-rose-400">Standard Error (stderr):</span>
                  <pre className="mono mt-1 max-h-48 overflow-y-auto rounded bg-[var(--axon-input-bg)] p-2.5 text-[11px] text-rose-300">
                    {runResult.stderr}
                  </pre>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <Button variant="primary" onClick={() => setRunResult(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
