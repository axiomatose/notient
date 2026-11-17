import webPush from "web-push";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "./src/config.js";

async function main() {
  const config = loadConfig();
  if (!config.vapid.publicKey || !config.vapid.privateKey) {
    console.error(
      "VAPID keys are not configured. Please add them to your .env file.",
    );
    return;
  }

  webPush.setVapidDetails(
    "mailto:admin@example.com", // You should replace this with your email
    config.vapid.publicKey,
    config.vapid.privateKey,
  );

  const subscriptionFile = resolve(config.dataDir, "subscription.json");
  let subscription;
  try {
    subscription = JSON.parse(await readFile(subscriptionFile, "utf-8"));
  } catch (err) {
    console.error("Could not read subscription.json. Has a user subscribed?");
    return;
  }

  const payload = JSON.stringify({
    title: "Test Notification",
    body: "This is a test push notification from the server.",
  });

  try {
    await webPush.sendNotification(subscription, payload);
    console.log("Push notification sent successfully.");
  } catch (err) {
    console.error("Error sending push notification:", err);
  }
}

main().catch(console.error);
