import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { connectDB } from "../mongo.server";
import { Pincode } from "../models/pincode.server";
import { isValidPostcode, normalizeCountry, normalizePostcode } from "../utils/postcode"; // naya

// Dropdown ke desh (code, naam) // naya
const COUNTRIES = [
  ["IN", "India"],
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["NL", "Netherlands"],
  ["JP", "Japan"],
  ["AE", "United Arab Emirates"],
  ["SG", "Singapore"],
] as const;

type CsvRow = {
  country: string; // naya
  pincode: string;
  minDays: number;
  maxDays: number;
  codAvailable: boolean;
};

const MAX_ROWS = 50000;

// CSV text ko rows mein badalta hai, galat rows ka hisaab rakhta hai
function parseCsv(text: string) {
  const rows: CsvRow[] = [];
  const errors: string[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/); // Excel ka BOM hatao

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (!line.trim()) return; // khaali line

    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

    // pehli line header ho to skip. Naam se pehchaan, kyunki UK jaise postcode letters se shuru hote hain // naya
    if (lineNo === 1 && /pin|post|zip/i.test(cells[0])) return;

    const [rawPin, min, max, cod, rawCountry] = cells; // naya: 5th column country

    const country = normalizeCountry(rawCountry); // naya (khaali ho to IN)
    const pin = normalizePostcode(rawPin, country); // naya

    if (!isValidPostcode(pin, country)) { // naya
      errors.push(`Row ${lineNo}: invalid postal code "${rawPin}" for ${country}`);
      return;
    }

    const minDays = min ? Number(min) : 3;
    const maxDays = max ? Number(max) : 5;

    if (!Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays < 0 || maxDays < 0) {
      errors.push(`Row ${lineNo}: days must be whole numbers`);
      return;
    }
    if (minDays > maxDays) {
      errors.push(`Row ${lineNo}: min days cannot be greater than max days`);
      return;
    }

    const codText = (cod || "yes").toLowerCase();
    const codAvailable = !["no", "false", "0", "n"].includes(codText);

    rows.push({ country, pincode: pin, minDays, maxDays, codAvailable });
  });

  return { rows, errors };
}

// naya: country column + UK/US example
const CSV_EXAMPLE = `pincode,min_days,max_days,cod,country
452001,2,4,yes,IN
110001,3,5,yes,IN
SW1A 1AA,5,8,no,GB
90210,4,7,no,US`;

// Page khulte hi: is store ke saare postal codes laao
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const docs = await Pincode.find({ shop: session.shop })
    .sort({ country: 1, pincode: 1 }) // naya: pehle desh, phir code
    .lean();
  return {
    pincodes: docs.map((p) => ({
      id: String(p._id),
      country: p.country, // naya
      pincode: p.pincode,
      minDays: p.minDays,
      maxDays: p.maxDays,
      codAvailable: p.codAvailable,
    })),
  };
};

// Form submit hone par: add/update, CSV upload ya delete
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const form = await request.formData();

  // CSV bulk upload
  if (form.get("intent") === "csv") {
    const file = form.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, source: "csv", message: "Please choose a CSV file" };
    }
    if (file.size > 5 * 1024 * 1024) {
      return { ok: false, source: "csv", message: "File is too large (max 5 MB)" };
    }

    const { rows, errors } = parseCsv(await file.text());

    if (rows.length > MAX_ROWS) {
      return { ok: false, source: "csv", message: `Too many rows (max ${MAX_ROWS})` };
    }
    if (rows.length === 0) {
      return { ok: false, source: "csv", message: "No valid rows found", errors: errors.slice(0, 10) };
    }

    // 1000-1000 ke batch mein save
    const ops = rows.map((r) => ({
      updateOne: {
        filter: { shop: session.shop, country: r.country, pincode: r.pincode }, // naya: country
        update: { $set: { minDays: r.minDays, maxDays: r.maxDays, codAvailable: r.codAvailable } },
        upsert: true,
      },
    }));
    for (let i = 0; i < ops.length; i += 1000) {
      await Pincode.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    }

    return {
      ok: true,
      source: "csv",
      message:
        `${rows.length} postal codes imported` +
        (errors.length ? `, ${errors.length} rows skipped` : ""),
      errors: errors.slice(0, 10),
    };
  }

  if (form.get("intent") === "delete") {
    await Pincode.deleteOne({ _id: String(form.get("id")), shop: session.shop });
    return { ok: true, message: "Postal code deleted" };
  }

  // Ek-ek karke add / update
  const country = normalizeCountry(form.get("country")); // naya
  const pincode = normalizePostcode(form.get("pincode"), country); // naya
  const minDays = Number(form.get("minDays") || 3);
  const maxDays = Number(form.get("maxDays") || 5);
  const codAvailable = form.get("codAvailable") === "on";

  if (!isValidPostcode(pincode, country)) { // naya
    return { ok: false, message: `Please enter a valid postal code for ${country}` };
  }
  if (minDays > maxDays) {
    return { ok: false, message: "Min days cannot be greater than max days" };
  }

  await Pincode.findOneAndUpdate(
    { shop: session.shop, country, pincode }, // naya: country
    { minDays, maxDays, codAvailable },
    { upsert: true },
  );
  return { ok: true, message: `${country} ${pincode} saved` };
};

export default function PincodesPage() {
  const { pincodes } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const saving = nav.state === "submitting";
  const isCsv = !!result && "source" in result && result.source === "csv";

  return (
    <s-page heading="Pincodes">
      <s-section heading="Add new postal code">
        <Form method="post" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          {/* naya: country dropdown */}
          <label>
            Country<br />
            <select name="country" defaultValue="IN">
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Postal code<br />
            {/* naya: letters bhi chalenge, max 10 */}
            <input name="pincode" placeholder="452001 / SW1A 1AA" maxLength={10} required />
          </label>
          <label>
            Min days<br />
            <input name="minDays" type="number" defaultValue={3} min={0} style={{ width: 70 }} />
          </label>
          <label>
            Max days<br />
            <input name="maxDays" type="number" defaultValue={5} min={0} style={{ width: 70 }} />
          </label>
          <label>
            <input name="codAvailable" type="checkbox" defaultChecked /> COD available
          </label>
          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </Form>
        {result && !isCsv && (
          <p style={{ color: result.ok ? "green" : "red", marginTop: 12 }}>{result.message}</p>
        )}
      </s-section>

      <s-section heading="Bulk upload (CSV)">
        <p style={{ marginTop: 0 }}>
          Columns: <b>pincode, min_days, max_days, cod, country</b>. Country is optional (default
          IN). Existing codes will be updated.
        </p>
        <pre style={{ background: "#f6f6f7", padding: 10, borderRadius: 6, fontSize: 13 }}>
          {CSV_EXAMPLE}
        </pre>

        <Form
          method="post"
          encType="multipart/form-data"
          style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
        >
          <input type="hidden" name="intent" value="csv" />
          <input type="file" name="file" accept=".csv,text/csv" required />
          <button type="submit" disabled={saving}>
            {saving ? "Uploading..." : "Upload CSV"}
          </button>
        </Form>

        {isCsv && result && (
          <div style={{ marginTop: 12 }}>
            <p style={{ color: result.ok ? "green" : "red", margin: 0 }}>{result.message}</p>
            {"errors" in result && result.errors && result.errors.length > 0 && (
              <ul style={{ color: "#c0392b", marginTop: 6 }}>
                {result.errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </s-section>

      <s-section heading={`Saved postal codes (${pincodes.length})`}>
        {pincodes.length === 0 ? (
          <p>No postal codes added yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th>Country</th>{/* naya */}
                <th>Postal code</th>
                <th>Delivery</th>
                <th>COD</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pincodes.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid #eee" }}>
                  <td>{p.country}</td>{/* naya */}
                  <td>{p.pincode}</td>
                  <td>{p.minDays}–{p.maxDays} days</td>
                  <td>{p.codAvailable ? "Yes" : "No"}</td>
                  <td>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit">Delete</button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </s-section>
    </s-page>
  );
}