import express from "express";
import { google } from "googleapis";
import { DateTime } from "luxon";

const app = express();
const port = process.env.PORT || 3000;

// REQUIRED ENV VARS
// GOOGLE_SERVICE_ACCOUNT_JSON: the full JSON key contents
// GOOGLE_CALENDAR_ID: calendar ID (often your gmail or the calendar's ID in settings)
// TIMEZONE: e.g. America/New_York (optional; defaults to America/New_York)

const TZ = process.env.TIMEZONE || "America/New_York";

function getCalendarIds() {
  const ids = (process.env.GOOGLE_CALENDAR_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Backward compatible with your current single-calendar setup
  if (ids.length === 0 && process.env.GOOGLE_CALENDAR_ID) {
    return [process.env.GOOGLE_CALENDAR_ID.trim()];
  }
  if (ids.length === 0) {
    throw new Error("Missing GOOGLE_CALENDAR_IDS (or GOOGLE_CALENDAR_ID)");
  }
  return ids;
}

function getJwtClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");
  }
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  return new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"]
  });
}

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.get("/events", async (req, res) => {
  try {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) throw new Error("Missing GOOGLE_CALENDAR_ID");

    const days = Math.min(parseInt(req.query.days || "30", 10), 365);
    const now = DateTime.now().setZone(TZ);
    const timeMin = now.toUTC().toISO();
    const timeMax = now.plus({ days }).toUTC().toISO();

    const auth = getJwtClient();
    const calendar = google.calendar({ version: "v3", auth });

    const resp = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 2500
    });

    const items = resp.data.items || [];

    // Normalize shape for display
    const events = items.map((e) => {
      const start = e.start?.dateTime || e.start?.date; // date = all-day
      const end = e.end?.dateTime || e.end?.date;

      return {
        id: e.id,
        title: e.summary || "(no title)",
        location: e.location || "",
        description: e.description || "",
        allDay: Boolean(e.start?.date),
        start,
        end
      };
    });

    res.json({
      timezone: TZ,
      range: { days, timeMin, timeMax },
      count: events.length,
      events
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.listen(port, () => {
  console.log(`calendar-aggregator listening on :${port}`);
});

