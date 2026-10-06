import mongoose from "mongoose";

declare global {
  // dev mein hot-reload par baar-baar naya connection na bane
  var mongooseConn: Promise<typeof mongoose> | undefined;
}

export function connectDB() {
  if (!global.mongooseConn) {
    global.mongooseConn = mongoose.connect(process.env.MONGODB_URI!, {
      dbName: process.env.MONGODB_DB,
    });
  }
  return global.mongooseConn;
}