// Ek baar chalane wali script: purane pincodes ko country "IN" do, purana index hatao
import "dotenv/config";
import dns from "node:dns";
import mongoose from "mongoose";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB });
const col = mongoose.connection.collection("pincodes");

const result = await col.updateMany(
  { country: { $exists: false } },
  { $set: { country: "IN" } },
);
console.log("Country added to", result.modifiedCount, "pincodes");

try {
  await col.dropIndex("shop_1_pincode_1");
  console.log("Old index dropped");
} catch (e) {
  console.log("Old index:", e.message);
}

await mongoose.disconnect();