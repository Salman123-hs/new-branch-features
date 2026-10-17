// Ek baar chalane wali script: 301001–301120 wale test pincodes hatao
import "dotenv/config";
import dns from "node:dns";
import mongoose from "mongoose";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB });
const col = mongoose.connection.collection("pincodes");

const result = await col.deleteMany({ country: "IN", pincode: { $regex: "^301" } });
console.log("Deleted", result.deletedCount, "test pincodes");

await mongoose.disconnect();