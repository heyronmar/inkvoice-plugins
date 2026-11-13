import { Database } from "bun:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { createApp } from "@inkvoice/backend/app";
import { closeDatabase, initDatabase } from "@inkvoice/backend/database/connection";
import { runMigrations } from "@inkvoice/backend/database/migrations";
import { seed } from "@inkvoice/backend/database/seed";
import type { Hono } from "hono";
import "@inkvoice/backend/plugins"; // registers leads so its migrations run
import { getDb } from "@inkvoice/backend/database/connection";
import { runPluginMigrations } from "@inkvoice/backend/plugins/runner";
import { setPluginEnabled } from "@inkvoice/backend/plugins/settings";
import { getCustomer } from "@inkvoice/backend/services/customer.service";
import { acceptQuote, createQuote, rejectQuote } from "@inkvoice/backend/services/quote.service";
import { resetEnvCache } from "@inkvoice/backend/utils/env";
import { defaultCrmConfig, saveCrmConfig } from "../backend/config";
import { crmMigrations } from "../backend/migrations";
import {
  convertLead,
  countByStage,
  createLead,
  deleteLead,
  getLead,
  listActivity,
  listLeads,
  startQuote,
  updateLead,
} from "../backend/service";

const TEST_DB = "./data/test-crm.db";
let app: Hono;
let token: string;

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "crmtestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
  resetEnvCache();
  initDatabase();
  runMigrations();
  runPluginMigrations();
  await seed();
  app = createApp();
  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "crmtestpass" }),
  });
  token = ((await res.json()) as any).data.token as string;
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

function call(path: string, opts: RequestInit = {}) {
  return app.request(`/api/v1/plugins/crm${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
}

describe("leads service", () => {
  test("create, update, delete; blanks stored as null", () => {
    const lead = createLead({ name: "Aroha", company: "", email: "a@example.nz", value: 1200 });
    expect(lead.stage).toBe("new");
    expect(lead.company).toBeNull();
    expect(updateLead(lead.id, { stage: "contacted" })?.stage).toBe("contacted");
    expect(deleteLead(lead.id)).toBe(true);
    expect(getLead(lead.id)).toBeNull();
  });

  test("open leads sort by soonest follow-up; closed leads last", () => {
    const later = createLead({ name: "Later", next_follow_up: "2030-02-01" });
    const soon = createLead({ name: "Soon", next_follow_up: "2030-01-01" });
    const lost = createLead({ name: "Lost", stage: "lost", next_follow_up: "2029-01-01" });
    const names = listLeads().map((l) => l.name);
    expect(names.indexOf("Soon")).toBeLessThan(names.indexOf("Later"));
    expect(names.indexOf("Later")).toBeLessThan(names.indexOf("Lost"));
    expect(countByStage().lost).toBeGreaterThanOrEqual(1);
    for (const l of [later, soon, lost]) deleteLead(l.id);
  });

  test("convert creates the customer once, named after the company", () => {
    const lead = createLead({ name: "Mere", company: "Kowhai Ltd", phone: "021 123 456" });
    const first = convertLead(lead.id)!;
    const customer = getCustomer(first.customer_id)!;
    expect(customer.name).toBe("Kowhai Ltd");
    expect(customer.notes).toContain("Contact: Mere");
    expect(customer.customer_type).toBe("company");
    expect(convertLead(lead.id)!.customer_id).toBe(first.customer_id);
  });

  test("lead type: chosen, or taken from the company name; carried to the customer", async () => {
    expect(createLead({ name: "Rewi", company: "Rewi Ltd" }).lead_type).toBe("company");
    expect(createLead({ name: "Hemi" }).lead_type).toBe("individual");
    // Chosen explicitly: a sole trader with a trading name is still a person.
    const sole = createLead({ name: "Kiri", company: "Kiri's Cakes", lead_type: "individual" });
    expect(getCustomer(convertLead(sole.id)!.customer_id)!.customer_type).toBe("individual");
    const shop = createLead({ name: "Tui", lead_type: "company" });
    expect(getCustomer(convertLead(shop.id)!.customer_id)!.customer_type).toBe("company");
    setPluginEnabled("crm", true);
    const bad = await call("/leads", {
      method: "POST",
      body: JSON.stringify({ name: "X", lead_type: "partnership" }),
    });
    expect(bad.status).toBe(400);
  });

  test("a lead without a company converts to an individual", () => {
    const lead = createLead({ name: "Wiremu" });
    const { customer_id } = convertLead(lead.id)!;
    expect(getCustomer(customer_id)!.customer_type).toBe("individual");
  });

  test("a lead moves to Quoted once its quote exists, then Won when it's accepted", () => {
    const lead = createLead({ name: "Tama" });
    const { customer_id } = startQuote(lead.id)!;
    // Starting a quote doesn't move the lead; saving the quote does.
    expect(getLead(lead.id)!.stage).toBe("new");
    const quote = createQuote({
      customer_id,
      issue_date: "2026-11-12",
      items: [{ description: "Website", quantity: 1, unit_price: 500 }],
    } as any);
    listLeads();
    const quoted = getLead(lead.id)!;
    expect(quoted.stage).toBe("quoted");
    expect(quoted.quote_id).toBe(quote.id);
    expect(quoted.quote_number).toBe(quote.quote_number);
    acceptQuote(quote.id);
    expect(listLeads({ stage: "won" }).some((l) => l.id === lead.id)).toBe(true);
  });
});

describe("leads routes", () => {
  test("hidden while the plugin is off", async () => {
    setPluginEnabled("crm", false);
    expect((await call("/leads")).status).toBe(404);
  });

  test("create, filter, export and quote once enabled", async () => {
    setPluginEnabled("crm", true);
    const created = await call("/leads", {
      method: "POST",
      body: JSON.stringify({ name: "Hemi", source: "referral", value: 900, email: "" }),
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as any).data.id;

    const bad = await call("/leads", { method: "POST", body: JSON.stringify({ name: "" }) });
    expect(bad.status).toBe(400);

    const list = (await (await call("/leads?stage=new&search=Hemi")).json()) as any;
    expect(list.data.items.map((l: any) => l.id)).toContain(id);
    expect(list.data.counts.new).toBeGreaterThanOrEqual(1);

    const csv = await (await call("/leads/export")).text();
    expect(csv.split("\r\n")[0]).toContain("Next Follow-up");
    expect(csv).toContain("Hemi");

    const quote = (await (await call(`/leads/${id}/quote`, { method: "POST" })).json()) as any;
    expect(quote.data.customer_id).toBeTruthy();

    const unknown = await call("/leads", {
      method: "POST",
      body: JSON.stringify({ name: "Ghost", stage: "c_nope1234" }),
    });
    expect(unknown.status).toBe(400);
  });

  test("listed in the Plugins tab with its own name", async () => {
    const res = await app.request("/api/v1/plugins/catalog", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as any;
    const items = body.data.plugins ?? body.data;
    const crm = items.find((p: any) => p.id === "crm");
    expect(crm.name).toBe("CRM");
    expect(crm.installed).toBe(true);
    expect(crm.enabled).toBe(true);
  });
});

function quoteFor(customer_id: string) {
  return createQuote({
    customer_id,
    issue_date: "2026-11-13",
    items: [{ description: "Work", quantity: 1, unit_price: 100 }],
  } as any);
}

type Config = ReturnType<typeof defaultCrmConfig>;

/** Default settings with some stages' actions and triggers changed. */
function configure(change: (c: Config) => void): Config {
  const config = defaultCrmConfig();
  change(config);
  return saveCrmConfig(config);
}

const stage = (c: Config, id: string) => c.stages.find((s) => s.id === id)!;

describe("leads settings", () => {
  // Each test shapes its own pipeline; leads left over would block removing a stage.
  beforeEach(() => getDb().run("DELETE FROM crm_leads"));
  afterAll(() => {
    getDb().run("DELETE FROM crm_leads");
    saveCrmConfig(defaultCrmConfig());
  });

  test("custom stages: Won and Lost stay last, names are required, sources de-duplicated", () => {
    const base = defaultCrmConfig();
    const config = saveCrmConfig({
      ...base,
      stages: [
        { ...stage(base, "won"), label: "Signed", hidden: true },
        { ...stage(base, "quoted"), label: " Proposal sent " },
        {
          id: "c_order1",
          label: "Order materials",
          color: "teal",
          hidden: false,
          actions: stage(base, "new").actions,
        },
        {
          id: "c_blank1",
          label: " ",
          color: "rose",
          hidden: false,
          actions: stage(base, "new").actions,
        },
        stage(base, "new"),
      ],
      sources: ["website", "Instagram", "Instagram", " "],
    });
    expect(config.stages.map((s) => s.id)).toEqual([
      "quoted",
      "c_order1",
      "c_blank1",
      "new",
      "won",
      "lost",
    ]);
    expect(config.stages[0].label).toBe("Proposal sent");
    expect(stage(config, "c_blank1").label).toBe("Stage");
    expect(stage(config, "won")).toMatchObject({ label: "Signed", hidden: false });
    expect(config.sources).toEqual(["website", "Instagram"]);
    // Contacted was removed, so nothing points there.
    expect(Object.values(config.triggers)).not.toContain("contacted");
  });

  test("contradicting rules are dropped", () => {
    const config = configure((c) => {
      c.triggers = {
        quote_accepted: "lost",
        invoice_paid: "lost",
        quote_declined: "won",
        quote_sent: "c_gone1",
      };
      stage(c, "lost").actions = { make_customer: true, follow_up_days: 3, create_project: true };
      stage(c, "won").actions.follow_up_days = 5;
    });
    expect(config.triggers).toEqual({});
    expect(stage(config, "lost").actions).toEqual({
      make_customer: false,
      follow_up_days: null,
      create_project: false,
    });
    expect(stage(config, "won").actions.follow_up_days).toBeNull();
  });

  test("old settings carry over", () => {
    const config = saveCrmConfig({
      stages: [{ id: "contacted", label: "Talking", hidden: false }],
      follow_up_days: 4,
      automations: {
        won_on_accept: true,
        lost_on_decline: true,
        contacted_on_follow_up: true,
        project_on_won: true,
      },
    } as any);
    expect(config.stages.map((s) => s.id)).toEqual(["contacted", "won", "lost"]);
    expect(stage(config, "contacted").actions.follow_up_days).toBe(4);
    expect(stage(config, "won").actions.create_project).toBe(true);
    // Contacted is the only working stage, so it's where leads start and
    // nothing moves them in; an invoice counts as accepted.
    expect(config.triggers).toEqual({ quote_accepted: "won", quote_declined: "lost" });
  });

  test("rules follow the stage's place in the pipeline", () => {
    const config = configure((c) => {
      c.triggers = {
        follow_up_set: "new", // first stage: leads start there
        quote_created: "contacted",
        quote_sent: "contacted", // one rule per stage
        quote_accepted: "quoted", // fine: after quote_created
        invoice_created: "won",
      };
      stage(c, "new").actions = { make_customer: true, follow_up_days: 2, create_project: true };
      stage(c, "quoted").actions.create_project = true;
      stage(c, "won").actions.make_customer = true;
    });
    expect(config.triggers).toEqual({
      quote_created: "contacted",
      quote_accepted: "quoted",
      invoice_created: "won",
    });
    expect(stage(config, "new").actions).toEqual({
      make_customer: false,
      follow_up_days: 2,
      create_project: false,
    });
    expect(stage(config, "quoted").actions.create_project).toBe(false);
    expect(stage(config, "won").actions.make_customer).toBe(true);

    // Moving Quoted before Contacted puts "accepted" ahead of "created": dropped.
    const reordered = defaultCrmConfig();
    reordered.stages = ["new", "quoted", "contacted", "won", "lost"].map((id) => stage(config, id));
    reordered.triggers = config.triggers;
    expect(saveCrmConfig(reordered).triggers).toEqual({
      quote_accepted: "quoted",
      invoice_created: "won",
    });
  });

  test("a stage with leads in it can't be removed", () => {
    saveCrmConfig(defaultCrmConfig());
    const lead = createLead({ name: "Pita", stage: "contacted" });
    const without = defaultCrmConfig();
    without.stages = without.stages.filter((s) => s.id !== "contacted");
    expect(() => saveCrmConfig(without)).toThrow(/Contacted \(\d+\)/);
    deleteLead(lead.id);
  });

  test("accepted quotes can be left alone", () => {
    configure((c) => {
      delete c.triggers.quote_accepted;
      delete c.triggers.invoice_created;
    });
    const lead = createLead({ name: "Rangi" });
    const { customer_id } = startQuote(lead.id)!;
    acceptQuote(quoteFor(customer_id).id);
    listLeads();
    expect(getLead(lead.id)!.stage).toBe("quoted");
  });

  test("declined goes to Lost; a revised quote brings the lead back", () => {
    configure((c) => {
      c.triggers.quote_declined = "lost";
    });
    const lead = createLead({ name: "Anahera" });
    const { customer_id } = startQuote(lead.id)!;
    const first = quoteFor(customer_id);
    listLeads();
    rejectQuote(first.id);
    listLeads();
    expect(getLead(lead.id)!.stage).toBe("lost");
    const revised = quoteFor(customer_id);
    listLeads();
    expect(getLead(lead.id)).toMatchObject({ stage: "quoted", quote_id: revised.id });
  });

  test("an event fires once: a lead moved by hand isn't pulled back", () => {
    saveCrmConfig(defaultCrmConfig());
    const lead = createLead({ name: "Hine" });
    const { customer_id } = startQuote(lead.id)!;
    quoteFor(customer_id);
    listLeads();
    expect(getLead(lead.id)!.stage).toBe("quoted");
    updateLead(lead.id, { stage: "contacted" });
    listLeads();
    expect(getLead(lead.id)!.stage).toBe("contacted");
  });

  test("quote events can go to custom stages; the last one reached wins", () => {
    configure((c) => {
      c.stages.splice(3, 0, {
        id: "c_sched1",
        label: "Schedule work",
        color: "teal",
        hidden: false,
        actions: { make_customer: false, follow_up_days: null, create_project: false },
      });
      c.triggers = { quote_sent: "quoted", quote_accepted: "c_sched1", invoice_paid: "won" };
    });
    const lead = createLead({ name: "Kiri" });
    const { customer_id } = startQuote(lead.id)!;
    const quote = quoteFor(customer_id);
    acceptQuote(quote.id); // sent and accepted seen in one go
    listLeads();
    expect(getLead(lead.id)!.stage).toBe("c_sched1");
  });

  test("setting a follow-up moves an existing open lead, once", () => {
    configure((c) => {
      c.triggers.follow_up_set = "contacted";
    });
    expect(createLead({ name: "Nikau", next_follow_up: "2030-01-01" }).stage).toBe("new");
    const lead = createLead({ name: "Ihaia" });
    expect(updateLead(lead.id, { next_follow_up: "2030-01-02" })!.stage).toBe("contacted");
    updateLead(lead.id, { stage: "new" });
    expect(updateLead(lead.id, { next_follow_up: "2030-01-03" })!.stage).toBe("new");
    // A stage chosen in the same change wins.
    const other = createLead({ name: "Ruia" });
    expect(updateLead(other.id, { next_follow_up: "2030-01-02", stage: "quoted" })!.stage).toBe(
      "quoted",
    );
  });

  test("arriving in a stage sets the follow-up in the user's local days", () => {
    configure((c) => {
      stage(c, "contacted").actions.follow_up_days = 3;
    });
    const lead = createLead({ name: "Moana" });
    expect(
      updateLead(lead.id, { stage: "contacted" }, { today: "2026-12-30" })!.next_follow_up,
    ).toBe("2027-01-02");
    // A date the user typed in the same change is kept.
    const typed = createLead({ name: "Tui" });
    expect(
      updateLead(typed.id, { stage: "contacted", next_follow_up: "2027-05-01" })!.next_follow_up,
    ).toBe("2027-05-01");
    expect(
      createLead({ name: "Huia", stage: "contacted" }, { today: "2026-01-01" }).next_follow_up,
    ).toBe("2026-01-04");
  });

  test("arriving can make a customer, and a Time Tracking project once", () => {
    configure((c) => {
      stage(c, "contacted").actions.make_customer = true;
      stage(c, "won").actions.create_project = true;
    });
    const met = createLead({ name: "Aperahama" });
    expect(updateLead(met.id, { stage: "contacted" })!.customer_id).toBeTruthy();

    setPluginEnabled("time-tracker", true);
    const lead = createLead({ name: "Mere", company: "Rata Design" });
    updateLead(lead.id, { stage: "won" });
    const won = getLead(lead.id)!;
    expect(won.customer_id).toBeTruthy();
    const project = getDb()
      .query("SELECT * FROM tt_projects WHERE id = ?")
      .get(won.project_id) as any;
    expect(project.name).toBe("Rata Design");
    expect(project.customer_id).toBe(won.customer_id);
    updateLead(lead.id, { stage: "contacted" });
    updateLead(lead.id, { stage: "won" });
    expect(getLead(lead.id)!.project_id).toBe(won.project_id);

    setPluginEnabled("time-tracker", false);
    const other = createLead({ name: "Tane" });
    updateLead(other.id, { stage: "won" });
    expect(getLead(other.id)!.project_id).toBeNull();
  });

  test("leads from before the upgrade aren't moved by quotes they already had", () => {
    saveCrmConfig(defaultCrmConfig());
    const lead = createLead({ name: "Old" });
    const { customer_id } = convertLead(lead.id)!;
    acceptQuote(quoteFor(customer_id).id);
    getDb().run("UPDATE crm_leads SET events_seen = NULL WHERE id = ?", [lead.id]);
    listLeads();
    expect(getLead(lead.id)!.stage).toBe("new");
  });

  test("settings routes: anyone with access reads, admins save, bad input is rejected", async () => {
    saveCrmConfig(defaultCrmConfig());
    setPluginEnabled("crm", true);
    const read = (await (await call("/settings")).json()) as any;
    expect(read.data.stages).toHaveLength(5);
    const bad = await call("/settings", { method: "PUT", body: JSON.stringify({ sources: "x" }) });
    expect(bad.status).toBe(400);
    const tooMany = Array.from({ length: 9 }, (_, i) => ({
      ...read.data.stages[0],
      id: `c_extra${i}`,
      label: `S${i}`,
    }));
    const many = await call("/settings", {
      method: "PUT",
      body: JSON.stringify({ ...read.data, stages: [...tooMany, ...read.data.stages.slice(3)] }),
    });
    expect(many.status).toBe(400);
    const saved = await call("/settings", {
      method: "PUT",
      body: JSON.stringify({ ...read.data, sources: ["Trade show"] }),
    });
    expect(((await saved.json()) as any).data.sources).toEqual(["Trade show"]);
    const custom = await call("/leads", {
      method: "POST",
      body: JSON.stringify({ name: "Kahu", source: "Trade show" }),
    });
    expect(custom.status).toBe(201);
  });
});

describe("upgrade from Leads", () => {
  test("takes over the Leads table, settings and on/off switch", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE plugin_schema_migrations (plugin_id TEXT, version INTEGER, name TEXT);
      CREATE TABLE ld_leads (id TEXT PRIMARY KEY, name TEXT NOT NULL, stage TEXT,
        next_follow_up TEXT, customer_id TEXT, quote_id TEXT);
      CREATE INDEX idx_ld_leads_stage ON ld_leads(stage);
      INSERT INTO ld_leads (id, name, stage) VALUES ('a1', 'Aroha', 'quoted');
      INSERT INTO settings VALUES ('leads_settings', '{"sources":["Trade show"]}');
      INSERT INTO settings VALUES ('enabled_plugins', '["time-tracker","leads"]');
      INSERT INTO plugin_schema_migrations VALUES ('leads', 3, 'leads_quote_events');
    `);
    crmMigrations[0].up(db);

    expect(db.query("SELECT name, stage FROM crm_leads").all()).toEqual([
      { name: "Aroha", stage: "quoted" },
    ]);
    const tables = db.query("SELECT name FROM sqlite_master WHERE name LIKE '%ld_leads%'").all();
    expect(tables).toEqual([]);
    const setting = (key: string) =>
      (db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null)
        ?.value;
    expect(setting("crm_settings")).toBe('{"sources":["Trade show"]}');
    expect(setting("leads_settings")).toBeUndefined();
    expect(JSON.parse(setting("enabled_plugins")!)).toEqual(["time-tracker", "crm"]);
    expect(db.query("SELECT * FROM plugin_schema_migrations").all()).toEqual([]);
  });
});

describe("activity history", () => {
  test("records who did what, and which event moved a lead", async () => {
    saveCrmConfig(defaultCrmConfig());
    const admin = getDb().query("SELECT id FROM users WHERE username = 'admin'").get() as {
      id: string;
    };
    const ctx = { userId: admin.id };
    const lead = createLead({ name: "Wiremu" }, ctx);
    updateLead(lead.id, { stage: "contacted", next_follow_up: "2030-03-01" }, ctx);
    const { customer_id } = startQuote(lead.id, ctx)!;
    quoteFor(customer_id);
    listLeads();

    const history = listActivity(lead.id);
    expect(history.map((a) => a.kind)).toEqual([
      "stage_changed",
      "quote_linked",
      "converted",
      "stage_changed",
      "follow_up_set",
      "created",
    ]);
    // Newest first: the quote moved it to Quoted, with no user.
    expect(history[0]).toMatchObject({
      data: { from: "contacted", to: "quoted", event: "quote_created" },
      user_id: null,
    });
    expect(history[3]).toMatchObject({
      data: { from: "new", to: "contacted" },
      user_name: "admin",
    });

    const res = await call(`/leads/${lead.id}/activity`);
    expect(((await res.json()) as any).data).toHaveLength(6);
    expect((await call("/leads/nope/activity")).status).toBe(404);

    deleteLead(lead.id);
    expect(listActivity(lead.id)).toEqual([]);
  });
});
