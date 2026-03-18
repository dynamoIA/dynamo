import path from "path";
import { fileURLToPath } from "url";
import { build as esbuild } from "esbuild";
import { rm, readFile } from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lista de dependencias que sí se incluyen en el bundle
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
  "discord.js" // ⚡ Incluimos discord.js para que los comandos funcionen
];

async function buildAll() {
  const distDir = path.resolve(__dirname, "dist");
  await rm(distDir, { recursive: true, force: true });

  console.log("Building server...");

  // Leer package.json para determinar dependencias
  const pkgPath = path.resolve(__dirname, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];

  // Todas las dependencias que NO están en allowlist se marcan como externas
  const externals = allDeps.filter(
    (dep) =>
      !allowlist.includes(dep) &&
      !(pkg.dependencies?.[dep]?.startsWith("workspace:"))
  );

  // Bundle con esbuild
  await esbuild({
    entryPoints: [path.resolve(__dirname, "src/index.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.resolve(distDir, "index.cjs"),
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
    sourcemap: true,        // 🔹 útil para debugging
    target: ["node18"],     // 🔹 ajustar según tu versión de Node
    allowOverwrite: true,
    loader: {
      ".ts": "ts",
      ".js": "js",
      ".json": "json"
    }
  });

  console.log("Build completo ✅");
}

buildAll().catch((err) => {
  console.error("Error durante el build:", err);
  process.exit(1);
});