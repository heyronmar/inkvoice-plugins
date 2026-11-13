import type { PluginMigration } from "@inkvoice/backend/plugins/registry";

// CRM schema. Tracked in plugin_schema_migrations under plugin_id = "crm".
//
// This plugin was called "Leads" (id "leads", table ld_leads) until 2.0.0.
// The first migration takes that install over: same rows, same settings, and
// switched on if Leads was on. Its old migration records are removed.
export const crmMigrations: PluginMigration[] = [
  {
    version: 1,
    name: "crm_leads_table",
    up: (db) => {
      const tableExists = (name: string) =>
        Boolean(
          db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
        );

      if (tableExists("ld_leads") && !tableExists("crm_leads")) {
        db.exec(`
          ALTER TABLE ld_leads RENAME TO crm_leads;
          DROP INDEX IF EXISTS idx_ld_leads_stage;
          DROP INDEX IF EXISTS idx_ld_leads_follow_up;
          DROP INDEX IF EXISTS idx_ld_leads_customer;
          DROP INDEX IF EXISTS idx_ld_leads_quote;
        `);
      } else {
        // quote_id: the quote a lead follows. events_seen: automation events
        // already handled (JSON array), so each fires once.
        db.exec(`
          CREATE TABLE IF NOT EXISTS crm_leads (
            id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            name TEXT NOT NULL,
            company TEXT,
            email TEXT,
            phone TEXT,
            source TEXT,
            value REAL,
            stage TEXT NOT NULL DEFAULT 'new',
            next_follow_up TEXT,
            notes TEXT,
            customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
            converted_at TEXT,
            project_id TEXT,
            quote_id TEXT,
            events_seen TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          );
        `);
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(stage);
        CREATE INDEX IF NOT EXISTS idx_crm_leads_follow_up ON crm_leads(next_follow_up);
        CREATE INDEX IF NOT EXISTS idx_crm_leads_customer ON crm_leads(customer_id);
        CREATE INDEX IF NOT EXISTS idx_crm_leads_quote ON crm_leads(quote_id);
      `);

      // Settings and the on/off switch carry over from Leads.
      const setting = (key: string) =>
        (db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null)
          ?.value ?? null;
      const old = setting("leads_settings");
      if (old !== null && setting("crm_settings") === null) {
        db.run("INSERT INTO settings (key, value) VALUES ('crm_settings', ?)", [old]);
      }
      db.run("DELETE FROM settings WHERE key = 'leads_settings'");

      const enabled = setting("enabled_plugins");
      if (enabled) {
        try {
          const ids = JSON.parse(enabled);
          if (Array.isArray(ids) && ids.includes("leads")) {
            const next = [...new Set(ids.map((id) => (id === "leads" ? "crm" : id)))];
            db.run("UPDATE settings SET value = ? WHERE key = 'enabled_plugins'", [
              JSON.stringify(next),
            ]);
          }
        } catch {
          // Not a list; leave it for the app to treat as before.
        }
      }

      db.run("DELETE FROM plugin_schema_migrations WHERE plugin_id = 'leads'");
    },
  },
  {
    version: 2,
    name: "crm_lead_activity",
    up: (db) => {
      // Each lead's history: created, stage moves (by whom, or which event),
      // follow-ups, conversion, quote and project. Room for richer entries.
      db.exec(`
        CREATE TABLE IF NOT EXISTS crm_lead_activity (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          lead_id TEXT NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          data TEXT,
          user_id TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_crm_lead_activity_lead
          ON crm_lead_activity(lead_id, created_at);
      `);
      // Existing leads start their history with when they were added.
      db.exec(`
        INSERT INTO crm_lead_activity (lead_id, kind, data, created_at)
        SELECT id, 'created', json_object('stage', stage), created_at FROM crm_leads
         WHERE id NOT IN (SELECT lead_id FROM crm_lead_activity WHERE kind = 'created');
      `);
    },
  },
];
