import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { connectDB } from "../mongo.server";
import { Pincode } from "../models/pincode.server";

// Page khulte hi: is store ke saare pincodes laao
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const docs = await Pincode.find({ shop: session.shop }).sort({ pincode: 1 }).lean();
  return {
    pincodes: docs.map((p) => ({
      id: String(p._id),
      pincode: p.pincode,
      minDays: p.minDays,
      maxDays: p.maxDays,
      codAvailable: p.codAvailable,
    })),
  };
};

// Form submit hone par: pincode add/update ya delete
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const form = await request.formData();

  if (form.get("intent") === "delete") {
    await Pincode.deleteOne({ _id: String(form.get("id")), shop: session.shop });
    return { ok: true, message: "Pincode deleted" };
  }

  const pincode = String(form.get("pincode") || "").trim();
  const minDays = Number(form.get("minDays") || 3);
  const maxDays = Number(form.get("maxDays") || 5);
  const codAvailable = form.get("codAvailable") === "on";

  if (!/^\d{6}$/.test(pincode)) {
    return { ok: false, message: "Pincode must be 6 digits" };
  }
  if (minDays > maxDays) {
    return { ok: false, message: "Min days cannot be greater than max days" };
  }

  await Pincode.findOneAndUpdate(
    { shop: session.shop, pincode },
    { minDays, maxDays, codAvailable },
    { upsert: true },
  );
  return { ok: true, message: `Pincode ${pincode} saved` };
};

export default function PincodesPage() {
  const { pincodes } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const saving = nav.state === "submitting";

  return (
    <s-page heading="Pincodes">
      <s-section heading="Add new pincode">
        <Form method="post" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <label>
            Pincode<br />
            <input name="pincode" placeholder="452001" maxLength={6} required />
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
        {result && (
          <p style={{ color: result.ok ? "green" : "red", marginTop: 12 }}>{result.message}</p>
        )}
      </s-section>

      <s-section heading={`Saved pincodes (${pincodes.length})`}>
        {pincodes.length === 0 ? (
          <p>No pincodes added yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th>Pincode</th>
                <th>Delivery</th>
                <th>COD</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pincodes.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid #eee" }}>
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