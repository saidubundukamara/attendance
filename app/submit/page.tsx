import { asc, eq } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { assignments, classes, cohorts } from "@/lib/db/schema";
import { appTimeZone } from "@/lib/timezone";
import { SubmitFlow } from "./submit-flow";

export const metadata = { title: "Submit work" };

export default async function SubmitPage() {
  // Read the class list on every request, not once at build time.
  await connection();
  // Only cohorts with a module that has something to hand in.
  const rows = await db
    .selectDistinct({ id: cohorts.id, name: cohorts.name })
    .from(cohorts)
    .innerJoin(classes, eq(classes.cohortId, cohorts.id))
    .innerJoin(assignments, eq(assignments.classId, classes.id))
    .orderBy(asc(cohorts.name))
    .all();

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 pt-[clamp(2.5rem,10vh,5rem)] pb-24">
      <div className="group stagger">
        <h1 className="text-4xl font-semibold tracking-tight">Submit work</h1>
        {/* Only needed before the student signs in; hidden after, to give a
            phone's first screen to the work itself. */}
        <p
          className="mt-2 text-muted group-has-[[data-signed-in]]:hidden"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          Hand in assignments, classwork and projects as PDF, Word (.docx) or
          ZIP files.
        </p>
        <div style={{ "--i": 2 } as React.CSSProperties}>
          {rows.length === 0 ? (
            <p className="mt-10 text-lg font-medium">
              Nothing to submit yet. Check back when your lecturer has set
              work.
            </p>
          ) : (
            <SubmitFlow cohorts={rows} timeZone={appTimeZone()} />
          )}
        </div>
      </div>
    </main>
  );
}
