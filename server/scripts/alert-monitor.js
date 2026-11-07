#!/usr/bin/env node
import {
  loadNotificationConfig,
  runAlertChecks,
  checkDailyReportDue,
  generateDailyReport,
  testChannel,
  notify,
  publicNotificationConfig,
} from "../lib/notifications.js";

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "--help";

  try {
    switch (command) {
      case "--check": {
        console.log(`[${new Date().toISOString()}] Running server alert checks...`);
        const res = await runAlertChecks();
        console.log("Check result:", JSON.stringify(res, null, 2));
        break;
      }

      case "--cron-tick": {
        // Run alert checks first
        await runAlertChecks();
        // Check if daily report is due this minute
        await checkDailyReportDue();
        break;
      }

      case "--report": {
        console.log(`[${new Date().toISOString()}] Generating and sending Daily Server Health Report...`);
        const res = await generateDailyReport();
        console.log("Daily report dispatched successfully:", JSON.stringify(res.summary, null, 2));
        break;
      }

      case "--test":
      case "--test-telegram": {
        console.log("Sending test alert to Telegram...");
        const res = await testChannel({ channel: "telegram" });
        console.log("Success:", res.message);
        break;
      }

      case "--test-slack": {
        console.log("Sending test alert to Slack...");
        const res = await testChannel({ channel: "slack" });
        console.log("Success:", res.message);
        break;
      }

      case "--status": {
        console.log("=== Axon Notification & Alert Status ===");
        console.log(JSON.stringify(publicNotificationConfig(), null, 2));
        break;
      }

      case "--notify": {
        const msg = args.slice(1).join(" ") || "Manual server notice";
        console.log(`Sending manual notification: "${msg}"...`);
        const res = await notify({
          title: "Server Notice",
          message: msg,
          level: "info",
        });
        console.log("Result:", JSON.stringify(res, null, 2));
        break;
      }

      case "--help":
      default:
        console.log(`
Axon Panel Server Alert & Daily Report CLI

Usage:
  node server/scripts/alert-monitor.js [command]

Commands:
  --check          Run threshold & service health checks and dispatch alerts if needed
  --cron-tick      Run periodic check and trigger daily report if scheduled time has arrived
  --report         Immediately generate and dispatch the Daily Server Health Report
  --test-telegram  Send a test notification to configured Telegram Bot & Chat
  --test-slack     Send a test notification to configured Slack Webhook
  --status         Print current notification configuration & thresholds
  --notify <msg>   Send an ad-hoc notification message to enabled channels
  --help           Show this help message
`);
        break;
    }
  } catch (err) {
    console.error(`[alert-monitor] Error:`, err.message || err);
    process.exit(1);
  }
}

main();
