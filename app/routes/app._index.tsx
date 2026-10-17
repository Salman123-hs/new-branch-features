import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { connectDB } from "../mongo.server";
import { Pincode } from "../models/pincode.server";
import { Settings } from "../models/settings.server";
import { Stats } from "../models/stats.server";

// Store ki themes + har theme ki product template (widget laga hai ya nahi dekhne ke liye)
const THEMES_QUERY = `#graphql
  query AppThemes {
    themes(first: 10) {
      nodes {
        id
        name
        role
        files(filenames: ["templates/product.json"], first: 1) {
          nodes {
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }
  }`;

type ThemeInfo = { id: string; name: string; role: string; hasWidget: boolean };

function timeAgo(date?: Date | string | null) {
  if (!date) return null;
  const sec = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (sec < 60) return "just now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const min = Math.round(sec / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.round(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  return rtf.format(-Math.round(hr / 24), "day");
}

function dayLabel(daysFromToday: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await connectDB();
  const shop = session.shop;

  const [total, countries, codCount, settingsSaved, stats] = await Promise.all([
    Pincode.countDocuments({ shop }),
    Pincode.distinct("country", { shop }),
    Pincode.countDocuments({ shop, codAvailable: true }),
    Settings.exists({ shop }),
    Stats.findOne({ shop }).lean(),
  ]);

  // Themes: permission na ho ya error aaye to null (page phir bhi chalega)
  let themes: ThemeInfo[] | null = null;
  try {
    const res = await admin.graphql(THEMES_QUERY);
    const json: any = await res.json();
    const nodes = json?.data?.themes?.nodes;
    if (Array.isArray(nodes)) {
      themes = nodes
      .filter((t: any) => t.role !== "ARCHIVED" && t.role !== "DEVELOPMENT") // CLI ki test themes chhupao
        .map((t: any) => ({
          id: String(t.id).split("/").pop() || "",
          name: t.name,
          role: t.role,
          // template JSON mein hamara block "…/blocks/pincode-checker/…" naam se hota hai
          hasWidget: String(t.files?.nodes?.[0]?.body?.content ?? "").includes("/blocks/pincode-checker/"),
        }))
        .sort((a: ThemeInfo, b: ThemeInfo) => (a.role === "MAIN" ? -1 : b.role === "MAIN" ? 1 : 0));
    }
  } catch {
    themes = null;
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    total,
    countries: countries.length,
    codPercent: total ? Math.round((codCount / total) * 100) : 0,
    settingsDone: Boolean(settingsSaved),
    checks: stats?.checks ?? 0,
    notAvailable: stats?.notAvailable ?? 0,
    lastCheck: timeAgo(stats?.lastCheckAt),
    hadCheck: Boolean(stats?.lastCheckAt),
    themes,
    previewFrom: dayLabel(2),
    previewTo: dayLabel(4),
  };
};

function StatCard({ icon, label, value, hint }: { icon: string; label: string; value: string | number; hint: string }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">
          {icon} {label}
        </s-text>
        <span style={{ fontSize: 28, fontWeight: 650, lineHeight: 1.2 }}>{value}</span>
        <s-text color="subdued">{hint}</s-text>
      </s-stack>
    </s-box>
  );
}

// Product page widget ka chhota preview (sirf dikhane ke liye)
function WidgetPreview({ from, to }: { from: string; to: string }) {
  return (
    <div
      style={{
        border: "1px solid #e3e3e3",
        borderRadius: 12,
        padding: 16,
        background: "#fff",
        boxShadow: "0 6px 20px rgba(0,0,0,0.06)",
        fontSize: 14,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 10 }}>Check delivery</div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, border: "1px solid #c9c9c9", borderRadius: 6, padding: "8px 10px" }}>452001</div>
        <div style={{ background: "#000", color: "#fff", borderRadius: 6, padding: "8px 14px", fontWeight: 600 }}>
          Check
        </div>
      </div>
      <div style={{ color: "#0a7d32", marginTop: 10 }}>
        🚚 Delivery by {from} – {to}
      </div>
      <div style={{ color: "#0a7d32", marginTop: 4 }}>💵 Cash on Delivery available</div>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  MAIN: "Live",
  UNPUBLISHED: "Draft",
  DEVELOPMENT: "Development",
  DEMO: "Demo",
};

export default function Index() {
  const d = useLoaderData<typeof loader>();

  const liveTheme = d.themes?.find((t) => t.role === "MAIN") ?? null;
  const widgetLive = Boolean(liveTheme?.hasWidget) || d.hadCheck;

  const addUrl = (themeId: string) =>
    `shopify://admin/themes/${themeId}/editor?template=product&addAppBlockId=${d.apiKey}/pincode-checker&target=mainSection`;
  const customizeUrl = (themeId: string) => `shopify://admin/themes/${themeId}/editor?template=product`;
  const liveEditorUrl = liveTheme ? addUrl(liveTheme.id) : addUrl("current");

  const steps = [
    {
      done: d.total > 0,
      title: "Add your delivery areas",
      text: "Add postal codes one by one, or upload a CSV with thousands at once.",
      button: "Add postal codes",
      href: "/app/pincodes",
    },
    {
      done: d.settingsDone,
      title: "Set your shipping schedule",
      text: "Processing days, cut-off time, working days and holidays decide the date customers see.",
      button: "Open settings",
      href: "/app/settings",
    },
    {
      done: widgetLive,
      title: "Show the checker on your product page",
      text: "Add the Pincode checker block to your live theme in one click.",
      button: "Add to live theme",
      href: liveEditorUrl,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const firstOpen = steps.findIndex((s) => !s.done);
  const allDone = doneCount === steps.length;
  const percent = Math.round((doneCount / steps.length) * 100);

  return (
    <s-page heading="Pincode & Delivery Checker">
      {/* ---------- Hero ---------- */}
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="large" alignItems="center">
          <s-stack direction="block" gap="base">
            {widgetLive ? (
              <s-badge tone="success">● Live{liveTheme ? ` on ${liveTheme.name}` : ""}</s-badge>
            ) : (
              <s-badge tone="warning">● Not live yet</s-badge>
            )}
            <s-heading>Show delivery dates. Win more orders.</s-heading>
            <s-paragraph>
              Customers enter their pincode on the product page and instantly see when it will arrive and
              whether Cash on Delivery is available. Fewer “when will it arrive?” questions, more confident buyers.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              {widgetLive && liveTheme ? (
                <s-button variant="primary" href={customizeUrl(liveTheme.id)}>
                  Customize widget
                </s-button>
              ) : (
                <s-button variant="primary" href={liveEditorUrl}>
                  Add to live theme
                </s-button>
              )}
              <s-button href="/app/pincodes">Manage postal codes</s-button>
            </s-stack>
          </s-stack>

          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">What customers see</s-text>
            <WidgetPreview from={d.previewFrom} to={d.previewTo} />
          </s-stack>
        </s-grid>
      </s-section>

      {/* ---------- Setup guide ---------- */}
      {allDone ? (
        <s-banner tone="success" heading="You're all set 🎉">
          Customers can now check delivery dates on your product pages.
        </s-banner>
      ) : (
        <s-section heading="Setup guide">
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-200">
              <s-text color="subdued">
                {doneCount} of {steps.length} steps completed
              </s-text>
              <div style={{ height: 8, background: "#e3e3e3", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${percent}%`, height: "100%", background: "#29845a", transition: "width 0.4s ease" }} />
              </div>
            </s-stack>

            {steps.map((step, i) => (
              <s-box
                key={step.title}
                padding="base"
                border="base"
                borderRadius="base"
                background={i === firstOpen ? "subdued" : undefined}
              >
                <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                  <s-stack direction="block" gap="small-200">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-badge tone={step.done ? "success" : "neutral"}>
                        {step.done ? "Done" : `Step ${i + 1}`}
                      </s-badge>
                      <s-text type="strong">{step.title}</s-text>
                    </s-stack>
                    <s-text color="subdued">{step.text}</s-text>
                  </s-stack>
                  {!step.done && (
                    <s-button href={step.href} variant={i === firstOpen ? "primary" : "secondary"}>
                      {step.button}
                    </s-button>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}

      {/* ---------- Stats ---------- */}
      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          <StatCard
            icon="📮"
            label="Postal codes"
            value={d.total.toLocaleString("en-IN")}
            hint={`${d.countries} ${d.countries === 1 ? "country" : "countries"}`}
          />
          <StatCard icon="💵" label="COD available" value={`${d.codPercent}%`} hint="of your postal codes" />
          <StatCard
            icon="👀"
            label="Customer checks"
            value={d.checks.toLocaleString("en-IN")}
            hint={d.lastCheck ? `Last check ${d.lastCheck}` : "No checks yet"}
          />
          <StatCard
            icon="🚫"
            label="Not deliverable"
            value={d.notAvailable.toLocaleString("en-IN")}
            hint="checks for areas you don't serve yet"
          />
        </s-grid>
      </s-section>

      {/* ---------- Themes ---------- */}
      <s-section heading="Themes" padding="none">
        {d.themes === null ? (
          <s-box padding="base">
            <s-banner tone="warning" heading="Theme access needed">
              We couldn't read your themes. Reopen the app and approve the theme permission, then refresh
              this page.
            </s-banner>
          </s-box>
        ) : (
          <>
            <s-box paddingInline="base" paddingBlockEnd="small">
              <s-text color="subdued">
                Tip: add the checker to a draft theme first if you want to test it before going live.
              </s-text>
            </s-box>
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Theme</s-table-header>
                <s-table-header listSlot="inline">Status</s-table-header>
                <s-table-header listSlot="labeled">Pincode checker</s-table-header>
                <s-table-header listSlot="labeled">Action</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {d.themes.map((t) => (
                  <s-table-row key={t.id}>
                    <s-table-cell>
                      <s-text type="strong">{t.name}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={t.role === "MAIN" ? "success" : "neutral"}>
                        {ROLE_LABEL[t.role] ?? t.role}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {t.hasWidget ? (
                        <s-badge tone="success">✓ Added</s-badge>
                      ) : (
                        <s-text color="subdued">Not added</s-text>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      {t.hasWidget ? (
                        <s-button variant="tertiary" href={customizeUrl(t.id)}>
                          Customize
                        </s-button>
                      ) : (
                        <s-button variant={t.role === "MAIN" ? "primary" : "secondary"} href={addUrl(t.id)}>
                          Add to theme
                        </s-button>
                      )}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);