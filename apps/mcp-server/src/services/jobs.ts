import { randomUUID } from "node:crypto";
import type { Job } from "../types.js";
import { errorMessage } from "../utils/errors.js";

export class JobManager {
  private jobs = new Map<string, Job>();

  startJob(kind: string, executor: () => Promise<unknown>): Job {
    const job: Job = { id: randomUUID(), kind, status: "running", createdAt: Date.now() };
    this.jobs.set(job.id, job);

    executor()
      .then((result) => {
        if (job.status === "cancelled") return;
        job.status = "done";
        job.result = result;
      })
      .catch((error: unknown) => {
        if (job.status === "cancelled") return;
        job.status = "error";
        job.error = errorMessage(error);
      });

    return job;
  }

  getStatus(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  getResult(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running") return false;
    job.status = "cancelled";
    return true;
  }
}
