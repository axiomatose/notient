import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import request from "supertest";
import http from "node:http";
import { nanoid } from "nanoid";
import { createTestContext } from "./helpers/testUtils.js";

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:one@test
DTSTART:${day(2)}T100000Z
DTEND:${day(2)}T110000Z
SUMMARY:Dentist
LOCATION:Main St
END:VEVENT
BEGIN:VEVENT
UID:allday@test
DTSTART;VALUE=DATE:${day(3)}
DTEND;VALUE=DATE:${day(4)}
SUMMARY:Holiday
END:VEVENT
BEGIN:VEVENT
UID:weekly@test
DTSTART:${day(1)}T090000Z
DTEND:${day(1)}T093000Z
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE:${day(8)}T090000Z
SUMMARY:Standup
END:VEVENT
END:VCALENDAR
`;

const multistatus = (inner) => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">${inner}</d:multistatus>`;

let server;
let base;
let hits = [];

beforeAll(async () => {
  process.env.NOTIENT_ALLOW_LOCAL_FEEDS = "1";
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push(`${req.method} ${req.url} ${req.headers.authorization ? "auth" : "anon"}`);
      if (req.url === "/feed.ics") {
        res.writeHead(200, { "content-type": "text/calendar" });
        return res.end(ICS);
      }
      if (req.url === "/private.ics" && !req.headers.authorization) {
        res.writeHead(401);
        return res.end();
      }
      if (req.url === "/private.ics") return res.end(ICS);
      if (req.url === "/notcal") return res.end("<html>hi</html>");
      if (req.method === "PROPFIND" && req.url === "/dav/") {
        const depth0 = body.includes("current-user-principal");
        return res.end(depth0 ? multistatus(`<d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/dav/me/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`) : multistatus(""));
      }
      if (req.method === "PROPFIND" && req.url === "/dav/me/") {
        const home = body.includes("calendar-home-set");
        return res.end(multistatus(home ? `<d:response><d:href>/dav/me/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>/dav/me/cals/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>` : ""));
      }
      if (req.method === "PROPFIND" && req.url === "/dav/me/cals/") {
        return res.end(
          multistatus(
            `<d:response><d:href>/dav/me/cals/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>` +
              `<d:response><d:href>/dav/me/cals/work/</d:href><d:propstat><d:prop><d:displayname>Work</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><a:calendar-color>#FF0000FF</a:calendar-color></d:prop></d:propstat></d:response>`,
          ),
        );
      }
      if (req.method === "REPORT" && req.url === "/dav/me/cals/work/") {
        return res.end(multistatus(`<d:response><d:href>/dav/me/cals/work/a.ics</d:href><d:propstat><d:prop><c:calendar-data><![CDATA[${ICS}]]></c:calendar-data></d:prop></d:propstat></d:response>`));
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => {
  server.close();
  delete process.env.NOTIENT_ALLOW_LOCAL_FEEDS;
});

describe("calendar subscriptions", () => {
  let context;
  let agent;
  let auth;

  beforeEach(async () => {
    hits = [];
    context = await createTestContext();
    agent = request(context.app);
    const res = await agent.post("/auth/register").send({ email: `sub-${nanoid(6)}@example.com`, password: "Passw0rd!23", deviceName: "d" });
    auth = { Authorization: `Bearer ${res.body.token}` };
  });
  afterEach(() => context.cleanup());

  const eventsOf = async (calendarId) => (await agent.get(`/calendars/${calendarId}/events`).set(auth)).body.events;

  it("subscribes to an ICS link, expanding the recurrence and dropping the exception", async () => {
    const res = await agent.post("/calendars/subscribe").set(auth).send({ url: `${base}/feed.ics`, name: "Feed" });
    expect(res.status).toBe(201);
    expect(res.body.calendar.readOnly).toBe(true);
    expect(res.body.calendar.syncKind).toBe("ics");
    const events = await eventsOf(res.body.calendar.id);
    const titles = events.map((e) => e.title).sort();
    // 4 weekly occurrences minus the excluded one, plus the two single events
    expect(titles.filter((t) => t === "Standup")).toHaveLength(3);
    expect(titles).toContain("Dentist");
    const holiday = events.find((e) => e.title === "Holiday");
    expect(holiday.allDay).toBe(true);
    expect(events.find((e) => e.title === "Dentist").location).toBe("Main St");
  });

  it("accepts webcal:// and uses credentials for a protected feed", async () => {
    const denied = await agent.post("/calendars/subscribe").set(auth).send({ url: `${base}/private.ics` });
    expect(denied.status).toBe(400);
    expect(denied.body.message).toMatch(/username or password/);
    const ok = await agent.post("/calendars/subscribe").set(auth).send({ url: `${base}/private.ics`, username: "u", password: "p" });
    expect(ok.status).toBe(201);
    const web = await agent.post("/calendars/subscribe").set(auth).send({ url: base.replace("http://", "webcal://") + "/feed.ics" });
    expect(web.status).toBe(201);
  });

  it("refuses a non-calendar address and leaves no calendar behind", async () => {
    const res = await agent.post("/calendars/subscribe").set(auth).send({ url: `${base}/notcal` });
    expect(res.status).toBe(400);
    const list = await agent.get("/calendars").set(auth);
    expect(list.body.calendars.some((c) => c.syncKind)).toBe(false);
  });

  it("discovers a CalDAV account and subscribes to its calendars", async () => {
    const found = await agent.post("/calendars/caldav/discover").set(auth).send({ url: `${base}/dav/`, username: "u", password: "p" });
    expect(found.status).toBe(200);
    expect(found.body.calendars).toEqual([{ url: `${base}/dav/me/cals/work/`, name: "Work", color: "#FF0000" }]);
    const added = await agent.post("/calendars/caldav/connect").set(auth).send({ url: `${base}/dav/`, username: "u", password: "p", calendars: found.body.calendars });
    expect(added.status).toBe(201);
    expect(added.body.added).toBe(1);
    const list = (await agent.get("/calendars").set(auth)).body.calendars.find((c) => c.syncKind === "caldav");
    expect(list.name).toBe("Work");
    expect((await eventsOf(list.id)).length).toBeGreaterThan(3);
  });

  it("keeps subscribed calendars read-only and re-syncs on demand", async () => {
    const sub = (await agent.post("/calendars/subscribe").set(auth).send({ url: `${base}/feed.ics` })).body.calendar;
    const create = await agent.post(`/calendars/${sub.id}/events`).set(auth).send({ title: "Mine", startTime: 1, endTime: 2 });
    expect(create.status).toBe(400);
    expect(create.body.error).toBe("read_only");
    const [first] = await eventsOf(sub.id);
    expect((await agent.delete(`/calendars/events/${first.id}`).set(auth)).status).toBe(400);
    const sync = await agent.post(`/calendars/${sub.id}/sync`).set(auth);
    expect(sync.status).toBe(200);
    expect((await eventsOf(sub.id)).length).toBe(sync.body.count);
  });
});
