import dotenv from "dotenv";
import express, { Request, Response } from "express";
import cors from "cors";
import reportsRouter from "./routes/reports";
import { getPositiveIntEnv, validateRuntimeEnv } from "./utils/env";

// Load env before reading process.env values in server bootstrap.
dotenv.config({ quiet: true });
validateRuntimeEnv("api");

const app = express();
const port = getPositiveIntEnv("PORT");

app.use(cors());
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/reports", reportsRouter);

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
