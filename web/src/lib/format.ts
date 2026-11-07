export function formatBytes(bytes: number | null | undefined, decimals = 1): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : decimals)} ${units[index]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatUptime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return formatDuration(Math.floor((Date.now() - ms) / 1000));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function statusTone(status: string | null | undefined): "ok" | "warn" | "bad" | "neutral" {
  switch ((status || "").toLowerCase()) {
    case "active":
    case "online":
    case "running":
    case "ok":
    case "online ":
      return "ok";
    case "activating":
    case "reloading":
    case "deactivating":
      return "warn";
    case "failed":
    case "inactive":
    case "dead":
    case "errored":
    case "stopped":
      return "bad";
    default:
      return "neutral";
  }
}
