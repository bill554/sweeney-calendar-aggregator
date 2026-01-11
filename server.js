import express from "express";
import { google } from "googleapis";
import { DateTime } from "luxon";

const app = express();
const port = process.env.PORT || 3000;

const TZ = process.env.TIMEZONE || "America/New_York";

// REQUIRED ENV VARS
// GOOGLE_SERVICE_ACCOUNT_JSON: full JSON key contents
// GOOGLE_CALENDAR_IDS: comma-separated calendar IDs (preferred)
// (or legacy) GOOGLE_CALENDAR_ID: single calendar ID

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

function getCalendarIds() {
  const ids = (process.env.GOOGLE_CALENDAR_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Backward compatible: allow old single-calendar env var
  if (ids.length === 0 && process.env.GOOGLE_CALENDAR_ID) {
    return [process.env.GOOGLE_CALENDAR_ID.trim()];
  }
  if (ids.length === 0) {
    throw new Error("Missing GOOGLE_CALENDAR_IDS (or GOOGLE_CALENDAR_ID)");
  }
  return ids;
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/events", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days || "30", 10), 365);
    const now = DateTime.now().setZone(TZ);
    const timeMin = now.toUTC().toISO();
    const timeMax = now.plus({ days }).toUTC().toISO();

    const auth = getJwtClient();
    const calendar = google.calendar({ version: "v3", auth });

    const calendarIds = getCalendarIds();

    const settled = await Promise.allSettled(
      calendarIds.map(async (calendarId) => {
        const resp = await calendar.events.list({
          calendarId,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 2500
        });

        const items = resp.data.items || [];
        const events = items.map((e) => {
          const start = e.start?.dateTime || e.start?.date;
          const end = e.end?.dateTime || e.end?.date;

          return {
            sourceCalendarId: calendarId,
            id: `${calendarId}:${e.id}`,
            title: e.summary || "(no title)",
            location: e.location || "",
            description: e.description || "",
            allDay: Boolean(e.start?.date),
            start,
            end
          };
        });

        return { calendarId, events };
      })
    );

    const errors = settled
      .filter((r) => r.status === "rejected")
      .map((r) => String(r.reason?.message || r.reason || "unknown error"));

    const fulfilled = settled
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value);

    const events = fulfilled
      .flatMap((x) => x.events)
      .sort((a, b) => (a.start || "").localeCompare(b.start || ""));

    res.json({
      timezone: TZ,
      calendarsRequested: calendarIds,
      calendarsSucceeded: fulfilled.map((f) => f.calendarId),
      errors,
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
