import path from "path";
import dotenv from "dotenv";

// Load the repo-root .env (resolves the same from src/ and dist/). Real env vars (Render) take precedence.
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET"),
  APP_URL: (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
  PORT: Number(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || "development",
};

if (env.NODE_ENV === "production" && /localhost|127\.0\.0\.1/.test(env.APP_URL)) {
  console.warn(`WARNING: APP_URL is ${env.APP_URL} in production; editUrl/publicUrl links will not work for clients.`);
}
